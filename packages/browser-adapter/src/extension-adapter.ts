import {
  RuntimeError,
  type BrowserAdapter,
  type BrowserAdapterEvent,
  type BrowserSource,
  type BrowserToolInvokeRequest,
  type BrowserToolInvokeResult,
  type RuntimeLog,
  type RuntimeTool,
} from "@mcp2webmcp/protocol";
import { WebSocketServer, type WebSocket } from "ws";
import {
  DEFAULT_EXTENSION_PORT,
  EXTENSION_PROTOCOL,
  EXTENSION_PROTOCOL_VERSION,
  parseExtensionClientMessage,
  type ExtensionClientMessage,
  type ExtensionServerMessage,
  type ExtensionToolSnapshot,
} from "./extension-protocol.js";
import {
  assertOriginPolicy,
  assertLoopbackHost,
  isLoopbackAddress,
  normalizeLoopbackHost,
  originIsAllowed,
} from "./mcpb-safety.js";

export interface ExtensionAdapterOptions {
  adapterId?: string;
  allowedOrigins: string[];
  host?: string;
  port?: number;
  invokeTimeoutMs?: number;
  /** Required shared token; the extension hello must carry the same value. */
  authToken: string;
  /** Grace period before a dropped WebSocket's sources are removed. 0 disables. */
  disconnectGraceMs?: number;
  log?: RuntimeLog;
}

interface PendingInvoke {
  sourceId: string;
  sourceGeneration: number;
  resolve: (result: BrowserToolInvokeResult) => void;
  reject: (error: Error) => void;
  abort: () => void;
}

interface SocketSession {
  socket: WebSocket;
  helloOk: boolean;
  helloTimer?: ReturnType<typeof setTimeout>;
}

export class ExtensionAdapter implements BrowserAdapter {
  readonly type = "extension";
  readonly adapterId: string;
  private revision = 0;
  private boundPort = 0;
  private server: WebSocketServer | undefined;
  private readonly sessions = new Set<SocketSession>();
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pingSeq = 0;
  private readonly allowedOrigins: Set<string>;
  private readonly host: string;
  private readonly port: number;
  private readonly invokeTimeoutMs: number;
  private readonly authToken: string;
  private readonly disconnectGraceMs: number;
  private readonly log?: RuntimeLog;
  private readonly listeners = new Set<(event: BrowserAdapterEvent) => void>();
  private readonly sources = new Map<string, BrowserSource>();
  private readonly sourceGenerations = new Map<string, number>();
  private readonly tools = new Map<string, Map<string, RuntimeTool>>();
  private readonly pending = new Map<string, PendingInvoke>();
  private readonly pingWaiters = new Map<string, () => void>();

  constructor(options: ExtensionAdapterOptions) {
    assertOriginPolicy(options.allowedOrigins);
    const host = normalizeLoopbackHost(options.host ?? "127.0.0.1");
    assertLoopbackHost(host);
    if (!options.authToken || options.authToken.length > 512) {
      throw new Error("extension adapter requires authToken between 1 and 512 characters");
    }
    this.adapterId = options.adapterId ?? "ext-1";
    this.allowedOrigins = new Set(options.allowedOrigins);
    this.host = host;
    this.port = options.port ?? DEFAULT_EXTENSION_PORT;
    this.invokeTimeoutMs = options.invokeTimeoutMs ?? 65_000;
    this.authToken = options.authToken;
    this.disconnectGraceMs = options.disconnectGraceMs ?? 15_000;
    this.log = options.log;
  }

  get listenPort(): number {
    return this.boundPort;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = new WebSocketServer({ host: this.host, port: this.port, maxPayload: 1_048_576 });
    this.server = server;
    server.on("connection", (socket, request) => {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        socket.close(4003, "loopback only");
        return;
      }
      const origin = request.headers.origin ?? "";
      if (!/^chrome-extension:\/\//i.test(origin)) {
        this.note("warn", "extension.ws.originRejected", { origin });
        socket.close(4003, "extension origin required");
        return;
      }
      this.attachSocket(socket);
    });
    await onceListening(server);
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("extension adapter failed to bind loopback port");
    }
    this.boundPort = address.port;
    this.pingTimer = setInterval(() => this.sendPing(), 20_000);
    this.note("info", "extension.listen", { host: this.host, port: this.boundPort });
  }

  async stop(): Promise<void> {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = undefined;
    this.rejectAllPending(new Error("extension adapter stopped"));
    this.dropSession();
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    this.listeners.clear();
  }

  subscribe(handler: (event: BrowserAdapterEvent) => void): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  async listSources(): Promise<BrowserSource[]> {
    return [...this.sources.values()].filter((source) => source.state !== "disconnected");
  }

  async listTools(sourceId: string): Promise<RuntimeTool[]> {
    return [...(this.tools.get(sourceId)?.values() ?? [])];
  }

  async invokeTool(
    request: BrowserToolInvokeRequest,
    options: { signal: AbortSignal; deadline: number },
  ): Promise<BrowserToolInvokeResult> {
    const source = this.sources.get(request.sourceId);
    if (!source || source.state !== "connected") {
      throw new Error(`source not connected: ${request.sourceId}`);
    }
    if (source.generation !== request.sourceGeneration) {
      throw new Error("generation mismatch");
    }
    const tool = this.tools.get(request.sourceId)?.get(request.originalName);
    if (!tool) {
      throw new Error(`tool not published: ${request.originalName}`);
    }
    if (!this.liveSession()) {
      throw new Error("extension is not connected");
    }
    if (options.signal.aborted) {
      throw new Error("invocation cancelled");
    }
    await this.ensureAwake();
    this.note(
      "info",
      "invoke.send",
      {
        sourceId: request.sourceId,
        originalName: request.originalName,
      },
      request.requestId,
    );
    const args = asInvokeArgs(request.input);
    const message: ExtensionServerMessage = {
      type: "invoke",
      requestId: request.requestId,
      sourceId: request.sourceId,
      sourceGeneration: request.sourceGeneration,
      originalName: request.originalName,
      args,
      deadline: options.deadline,
    };
    try {
      const result = await new Promise<BrowserToolInvokeResult>((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          options.signal.removeEventListener("abort", onAbort);
          this.pending.delete(request.requestId);
          fn();
        };
        const onAbort = () => {
          this.send({
            type: "invokeCancel",
            requestId: request.requestId,
            sourceId: request.sourceId,
            sourceGeneration: request.sourceGeneration,
          });
          finish(() => reject(new RuntimeError("CANCELLED", "invocation cancelled", "unknown")));
        };
        const remain = Math.max(1, Math.min(this.invokeTimeoutMs, options.deadline - Date.now()));
        const timer = setTimeout(
          () =>
            finish(() =>
              reject(
                new RuntimeError("OUTCOME_UNKNOWN", "extension invocation timed out", "unknown"),
              ),
            ),
          remain,
        );
        if (options.signal.aborted) {
          finish(() =>
            reject(new RuntimeError("CANCELLED", "invocation cancelled", "not_executed")),
          );
          return;
        }
        this.pending.set(request.requestId, {
          sourceId: request.sourceId,
          sourceGeneration: request.sourceGeneration,
          resolve: (result) => finish(() => resolve(result)),
          reject: (error) => finish(() => reject(error)),
          abort: onAbort,
        });
        options.signal.addEventListener("abort", onAbort, { once: true });
        this.send(message);
      });
      this.note(
        result.isError ? "warn" : "info",
        "invoke.result",
        { isError: Boolean(result.isError) },
        request.requestId,
      );
      return result;
    } catch (error) {
      this.note(
        "error",
        "invoke.failed",
        { message: error instanceof Error ? error.message : String(error) },
        request.requestId,
      );
      throw error;
    }
  }

  private note(
    level: "debug" | "info" | "warn" | "error",
    event: string,
    data?: Record<string, unknown>,
    traceId?: string,
  ): void {
    this.log?.write({ level, hop: "gateway", event, data, traceId });
  }

  private attachSocket(socket: WebSocket): void {
    this.note("info", "extension.ws.connected");
    const session: SocketSession = { socket, helloOk: false };
    this.sessions.add(session);
    session.helloTimer = setTimeout(() => {
      if (this.sessions.has(session) && !session.helloOk) {
        socket.close(4001, "hello timeout");
      }
    }, 10_000);
    socket.on("message", (data) => {
      if (!this.sessions.has(session)) return;
      const text = typeof data === "string" ? data : data.toString();
      const message = parseExtensionClientMessage(text);
      if (!message) {
        let droppedType: string | undefined;
        try {
          const parsed = JSON.parse(text) as { type?: unknown };
          droppedType = typeof parsed.type === "string" ? parsed.type : undefined;
        } catch {
          droppedType = undefined;
        }
        this.note("warn", "extension.message.dropped", { type: droppedType ?? "unparseable" });
        return;
      }
      this.onClientMessage(session, message);
    });
    socket.on("close", () => {
      if (!this.sessions.delete(session)) return;
      if (session.helloTimer) clearTimeout(session.helloTimer);
      this.rejectAllPending(
        new RuntimeError("OUTCOME_UNKNOWN", "extension disconnected during invocation", "unknown"),
      );
      if (session.helloOk) {
        this.note("warn", "extension.ws.disconnected");
        this.scheduleGraceExpiry();
      } else {
        this.note("warn", "extension.ws.closedBeforeHello");
      }
    });
  }

  private dropSession(): void {
    this.cancelGrace();
    for (const session of [...this.sessions]) {
      this.sessions.delete(session);
      if (session.helloTimer) clearTimeout(session.helloTimer);
      session.socket.removeAllListeners();
      if (session.socket.readyState === session.socket.OPEN) {
        session.socket.close(4000, "replaced");
      }
    }
    this.disconnectAllSources();
    this.rejectAllPending(
      new RuntimeError(
        "OUTCOME_UNKNOWN",
        "extension session replaced during invocation",
        "unknown",
      ),
    );
  }

  private scheduleGraceExpiry(): void {
    this.cancelGrace();
    if (this.disconnectGraceMs <= 0) {
      this.disconnectAllSources();
      return;
    }
    this.graceTimer = setTimeout(() => {
      this.graceTimer = undefined;
      this.note("warn", "extension.grace.expired");
      this.disconnectAllSources();
    }, this.disconnectGraceMs);
  }

  private cancelGrace(): void {
    if (this.graceTimer) clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  private onClientMessage(session: SocketSession, message: ExtensionClientMessage): void {
    if (message.type === "hello") {
      if (message.protocolVersion !== EXTENSION_PROTOCOL_VERSION) {
        this.note("error", "extension.hello.mismatch", {
          protocolVersion: message.protocolVersion,
        });
        session.socket.close(4002, "protocol version mismatch");
        return;
      }
      if (message.token !== this.authToken) {
        this.note("warn", "extension.hello.authFailed");
        session.socket.close(4001, "auth failed");
        return;
      }
      session.helloOk = true;
      if (session.helloTimer) {
        clearTimeout(session.helloTimer);
        session.helloTimer = undefined;
      }
      this.note("info", "extension.hello");
      for (const other of [...this.sessions]) {
        if (other === session || !other.helloOk) continue;
        this.sessions.delete(other);
        if (other.helloTimer) clearTimeout(other.helloTimer);
        other.socket.removeAllListeners();
        other.socket.close(4000, "replaced");
      }
      this.cancelGrace();
      this.sendTo(session, {
        type: "helloAck",
        protocol: EXTENSION_PROTOCOL,
        protocolVersion: EXTENSION_PROTOCOL_VERSION,
        adapterId: this.adapterId,
      });
      return;
    }
    if (!session.helloOk) return;
    if (message.type === "log") {
      this.log?.write({
        level: message.level,
        hop: message.hop,
        event: message.event,
        message: message.message,
        traceId: message.traceId,
        data: message.data,
      });
      return;
    }
    if (message.type === "ping") {
      this.send({ type: "pong", id: message.id });
      return;
    }
    if (message.type === "pong") {
      const waiter = this.pingWaiters.get(message.id);
      if (waiter) {
        this.pingWaiters.delete(message.id);
        waiter();
      }
      return;
    }
    if (message.type === "source.upsert") {
      this.note("info", "source.upsert", {
        sourceId: message.sourceId,
        origin: message.origin,
        reason: message.reason,
      });
      this.upsertSource(message);
      const source = this.sources.get(message.sourceId);
      if (source) {
        this.sendTo(session, {
          type: "sourceAck",
          sourceId: source.sourceId,
          sourceGeneration: source.generation,
        });
      }
      return;
    }
    if (message.type === "source.remove") {
      this.note("info", "source.remove", { sourceId: message.sourceId });
      this.removeSource(message.sourceId);
      return;
    }
    if (message.type === "tools.replace") {
      const names = message.tools.map((tool) => tool.originalName);
      this.note(message.runtimeError ? "warn" : "info", "tools.replace", {
        sourceId: message.sourceId,
        count: names.length,
        names,
        runtimePresent: message.runtimePresent,
        runtimeError: message.runtimeError,
      });
      this.replaceTools(message.sourceId, message.tools);
      return;
    }
    if (message.type === "invokeResult") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
      if (
        pending.sourceId !== message.sourceId ||
        pending.sourceGeneration !== message.sourceGeneration
      ) {
        this.note("warn", "invoke.result.stale", {
          sourceId: message.sourceId,
          sourceGeneration: message.sourceGeneration,
        });
        return;
      }
      if (message.error?.code === "OUTCOME_UNKNOWN") {
        pending.reject(new RuntimeError("OUTCOME_UNKNOWN", message.error.message, "unknown"));
        return;
      }
      const content =
        message.content.length > 0
          ? message.content
          : [{ type: "text", text: message.error?.message ?? "webmcp error" }];
      pending.resolve({
        content,
        structuredContent: message.structuredContent,
        isError: Boolean(message.isError),
      });
    }
  }

  private upsertSource(incoming: Extract<ExtensionClientMessage, { type: "source.upsert" }>): void {
    if (!originIsAllowed([...this.allowedOrigins], incoming.origin)) {
      this.note("warn", "source.rejected", {
        sourceId: incoming.sourceId,
        origin: incoming.origin,
        reason: "allowedOrigins",
      });
      this.removeSource(incoming.sourceId);
      return;
    }
    const existing = this.sources.get(incoming.sourceId);
    const now = Date.now();
    if (!existing) {
      const generation = (this.sourceGenerations.get(incoming.sourceId) ?? 0) + 1;
      const source: BrowserSource = {
        adapterId: this.adapterId,
        sourceId: incoming.sourceId,
        generation,
        browserId: "extension",
        tabId: incoming.tabId,
        origin: incoming.origin,
        url: incoming.url,
        title: incoming.title,
        adapterType: "extension",
        connectedAt: now,
        updatedAt: now,
        state: "connected",
      };
      this.sourceGenerations.set(source.sourceId, generation);
      this.sources.set(source.sourceId, source);
      this.tools.set(source.sourceId, new Map());
      this.emit({
        type: "source.connected",
        adapterId: this.adapterId,
        sourceId: source.sourceId,
        sourceGeneration: source.generation,
        revision: ++this.revision,
        source,
      });
      return;
    }

    const navigated = existing.origin !== incoming.origin || existing.url !== incoming.url;
    const bump = navigated || incoming.reason === "navigate" || incoming.reason === "reload";
    if (bump) {
      existing.generation += 1;
      this.sourceGenerations.set(existing.sourceId, existing.generation);
    }
    existing.origin = incoming.origin;
    existing.url = incoming.url;
    existing.title = incoming.title;
    existing.tabId = incoming.tabId;
    existing.updatedAt = now;
    existing.state = "connected";
    this.emit({
      type: "source.updated",
      adapterId: this.adapterId,
      sourceId: existing.sourceId,
      sourceGeneration: existing.generation,
      revision: ++this.revision,
      source: existing,
    });
  }

  private replaceTools(sourceId: string, incoming: ExtensionToolSnapshot[]): void {
    const source = this.sources.get(sourceId);
    if (!source || source.state !== "connected") return;
    if (!originIsAllowed([...this.allowedOrigins], source.origin)) return;
    const bucket = this.tools.get(sourceId) ?? new Map();
    const nextNames = new Set(incoming.map((tool) => tool.originalName));
    for (const originalName of [...bucket.keys()]) {
      if (!nextNames.has(originalName)) {
        this.unregisterTool(source, originalName);
      }
    }
    for (const tool of incoming) {
      this.upsertTool(source, tool);
    }
  }

  private upsertTool(source: BrowserSource, incoming: ExtensionToolSnapshot): void {
    const bucket = this.tools.get(source.sourceId) ?? new Map();
    const existing = bucket.get(incoming.originalName);
    const now = Date.now();
    const complete: RuntimeTool = {
      identity: {
        adapterId: this.adapterId,
        sourceId: source.sourceId,
        sourceGeneration: source.generation,
        originalName: incoming.originalName,
        runtimeId: existing?.identity.runtimeId || "pending",
        mcpName: existing?.identity.mcpName || incoming.originalName,
      },
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      description: incoming.description,
      inputSchema: incoming.inputSchema,
      annotations: incoming.annotations,
      discoveredAt: existing?.discoveredAt ?? now,
      updatedAt: now,
      status: "available",
    };
    bucket.set(incoming.originalName, complete);
    this.tools.set(source.sourceId, bucket);
    if (
      existing &&
      existing.sourceGeneration === complete.sourceGeneration &&
      toolSnapshotKey(existing) === toolSnapshotKey(complete)
    ) {
      return;
    }
    this.emit({
      type: existing ? "tool.updated" : "tool.registered",
      adapterId: this.adapterId,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
      tool: complete,
    });
  }

  private unregisterTool(source: BrowserSource, originalName: string): void {
    const tool = this.tools.get(source.sourceId)?.get(originalName);
    this.tools.get(source.sourceId)?.delete(originalName);
    this.emit({
      type: "tool.unregistered",
      adapterId: this.adapterId,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
      runtimeId: tool?.identity.runtimeId ?? "",
      originalName,
    });
  }

  private clearTools(sourceId: string): void {
    const source = this.sources.get(sourceId);
    const names = [...(this.tools.get(sourceId)?.keys() ?? [])];
    for (const originalName of names) {
      if (source) this.unregisterTool(source, originalName);
    }
    this.tools.set(sourceId, new Map());
  }

  private removeSource(sourceId: string): void {
    const source = this.sources.get(sourceId);
    if (!source) return;
    this.clearTools(sourceId);
    this.sources.delete(sourceId);
    this.tools.delete(sourceId);
    this.emit({
      type: "source.disconnected",
      adapterId: this.adapterId,
      sourceId,
      sourceGeneration: source.generation,
      revision: ++this.revision,
    });
  }

  private disconnectAllSources(): void {
    for (const sourceId of [...this.sources.keys()]) {
      this.removeSource(sourceId);
    }
  }

  private liveSession(): SocketSession | undefined {
    for (const session of this.sessions) {
      if (session.helloOk) return session;
    }
    return undefined;
  }

  private send(message: ExtensionServerMessage): void {
    const session = this.liveSession();
    if (!session) return;
    this.sendTo(session, message);
  }

  private sendTo(session: SocketSession, message: ExtensionServerMessage): void {
    const socket = session.socket;
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private sendPing(): void {
    if (!this.liveSession()) return;
    this.send({ type: "ping", id: `g${++this.pingSeq}` });
  }

  private async ensureAwake(): Promise<void> {
    if (!this.liveSession()) {
      throw new Error("extension is not connected");
    }
    const id = `pre-invoke-${++this.pingSeq}`;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pingWaiters.delete(id);
        reject(new Error("extension ping timeout"));
      }, 2_000);
      this.pingWaiters.set(id, () => {
        clearTimeout(timer);
        resolve();
      });
      this.send({ type: "ping", id });
    });
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }

  private emit(event: BrowserAdapterEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

function toolSnapshotKey(
  tool: Pick<RuntimeTool, "identity" | "description" | "inputSchema" | "annotations">,
): string {
  return JSON.stringify({
    originalName: tool.identity.originalName,
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? {},
    annotations: tool.annotations ?? {},
  });
}

function asInvokeArgs(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) {
    return input as Record<string, unknown>;
  }
  if (input === undefined) return undefined;
  return { value: input };
}

function onceListening(server: WebSocketServer): Promise<void> {
  if (server.address()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const fail = (error: Error) => {
      server.off("listening", ok);
      reject(error);
    };
    const ok = () => {
      server.off("error", fail);
      resolve();
    };
    server.once("listening", ok);
    server.once("error", fail);
  });
}

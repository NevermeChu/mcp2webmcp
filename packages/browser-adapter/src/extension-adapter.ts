import type {
  BrowserAdapter,
  BrowserAdapterEvent,
  BrowserSource,
  BrowserToolInvokeRequest,
  BrowserToolInvokeResult,
  RuntimeTool,
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
}

interface PendingInvoke {
  sourceId: string;
  resolve: (result: BrowserToolInvokeResult) => void;
  reject: (error: Error) => void;
  abort: () => void;
}

interface SocketSession {
  socket: WebSocket;
  helloOk: boolean;
}

export class ExtensionAdapter implements BrowserAdapter {
  readonly type = "extension";
  readonly adapterId: string;
  private revision = 0;
  private boundPort = 0;
  private server: WebSocketServer | undefined;
  private session: SocketSession | undefined;
  private pingTimer: ReturnType<typeof setInterval> | undefined;
  private pingSeq = 0;
  private readonly allowedOrigins: Set<string>;
  private readonly host: string;
  private readonly port: number;
  private readonly invokeTimeoutMs: number;
  private readonly listeners = new Set<(event: BrowserAdapterEvent) => void>();
  private readonly sources = new Map<string, BrowserSource>();
  private readonly tools = new Map<string, Map<string, RuntimeTool>>();
  private readonly pending = new Map<string, PendingInvoke>();
  private readonly pingWaiters = new Map<string, () => void>();

  constructor(options: ExtensionAdapterOptions) {
    assertOriginPolicy(options.allowedOrigins);
    const host = normalizeLoopbackHost(options.host ?? "127.0.0.1");
    assertLoopbackHost(host);
    this.adapterId = options.adapterId ?? "ext-1";
    this.allowedOrigins = new Set(options.allowedOrigins);
    this.host = host;
    this.port = options.port ?? DEFAULT_EXTENSION_PORT;
    this.invokeTimeoutMs = options.invokeTimeoutMs ?? 65_000;
  }

  get listenPort(): number {
    return this.boundPort;
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = new WebSocketServer({ host: this.host, port: this.port });
    this.server = server;
    server.on("connection", (socket, request) => {
      if (!isLoopbackAddress(request.socket.remoteAddress)) {
        socket.close(4003, "loopback only");
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
    if (!this.session?.helloOk) {
      throw new Error("extension is not connected");
    }
    if (options.signal.aborted) {
      throw new Error("invocation cancelled");
    }
    await this.ensureAwake();
    const args = asInvokeArgs(request.input);
    const message: ExtensionServerMessage = {
      type: "invoke",
      requestId: request.requestId,
      sourceId: request.sourceId,
      originalName: request.originalName,
      args,
      deadline: options.deadline,
    };
    return await new Promise<BrowserToolInvokeResult>((resolve, reject) => {
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
        });
        finish(() => reject(new Error("invocation cancelled")));
      };
      const remain = Math.max(1, Math.min(this.invokeTimeoutMs, options.deadline - Date.now()));
      const timer = setTimeout(() => finish(() => reject(new Error("invocation cancelled"))), remain);
      if (options.signal.aborted) {
        finish(() => reject(new Error("invocation cancelled")));
        return;
      }
      this.pending.set(request.requestId, {
        sourceId: request.sourceId,
        resolve: (result) => finish(() => resolve(result)),
        reject: (error) => finish(() => reject(error)),
        abort: onAbort,
      });
      options.signal.addEventListener("abort", onAbort, { once: true });
      this.send(message);
    });
  }

  private attachSocket(socket: WebSocket): void {
    this.dropSession();
    const session: SocketSession = { socket, helloOk: false };
    this.session = session;
    socket.on("message", (data) => {
      if (this.session !== session) return;
      const text = typeof data === "string" ? data : data.toString();
      const message = parseExtensionClientMessage(text);
      if (!message) return;
      this.onClientMessage(session, message);
    });
    socket.on("close", () => {
      if (this.session === session) {
        this.session = undefined;
        this.disconnectAllSources();
        this.rejectAllPending(new Error("extension disconnected"));
      }
    });
  }

  private dropSession(): void {
    const current = this.session;
    this.session = undefined;
    this.pingWaiters.clear();
    if (current) {
      current.socket.removeAllListeners();
      if (current.socket.readyState === current.socket.OPEN) {
        current.socket.close(4000, "replaced");
      }
    }
    this.disconnectAllSources();
    this.rejectAllPending(new Error("extension disconnected"));
  }

  private onClientMessage(session: SocketSession, message: ExtensionClientMessage): void {
    if (message.type === "hello") {
      if (message.protocolVersion !== EXTENSION_PROTOCOL_VERSION) {
        session.socket.close(4002, "protocol version mismatch");
        return;
      }
      session.helloOk = true;
      this.send({
        type: "helloAck",
        protocol: EXTENSION_PROTOCOL,
        protocolVersion: EXTENSION_PROTOCOL_VERSION,
        adapterId: this.adapterId,
      });
      return;
    }
    if (!session.helloOk) return;
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
      this.upsertSource(message);
      return;
    }
    if (message.type === "source.remove") {
      this.removeSource(message.sourceId);
      return;
    }
    if (message.type === "tools.replace") {
      this.replaceTools(message.sourceId, message.tools);
      return;
    }
    if (message.type === "invokeResult") {
      const pending = this.pending.get(message.requestId);
      if (!pending) return;
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
      this.removeSource(incoming.sourceId);
      return;
    }
    const existing = this.sources.get(incoming.sourceId);
    const now = Date.now();
    if (!existing) {
      const source: BrowserSource = {
        adapterId: this.adapterId,
        sourceId: incoming.sourceId,
        generation: 1,
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
    const bump =
      navigated || incoming.reason === "navigate" || incoming.reason === "reload";
    if (bump) {
      existing.generation += 1;
      this.clearTools(existing.sourceId);
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

  private send(message: ExtensionServerMessage): void {
    const socket = this.session?.socket;
    if (!socket || socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify(message));
  }

  private sendPing(): void {
    if (!this.session?.helloOk) return;
    this.send({ type: "ping", id: `g${++this.pingSeq}` });
  }

  private async ensureAwake(): Promise<void> {
    if (!this.session?.helloOk) {
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

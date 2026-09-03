const CHANNEL = "mcp2webmcp-ext";
const PAGE_INSTANCE_ID = crypto.randomUUID();

function post(payload) {
  window.postMessage(
    {
      channel: CHANNEL,
      direction: "page-to-isolated",
      pageInstanceId: PAGE_INSTANCE_ID,
      ...payload,
    },
    window.location.origin,
  );
}

const tools = new Map();
let wrappedContext = null;
let runtimeError = "no-webmcp-runtime";
const pendingInvokes = new Map();

function snapshotTools() {
  return [...tools.values()].map((entry) => ({
    originalName: entry.originalName,
    description: entry.description,
    inputSchema: entry.inputSchema && typeof entry.inputSchema === "object" ? entry.inputSchema : { type: "object", properties: {} },
    annotations: entry.annotations,
  }));
}

function publishSnapshot() {
  post({
    kind: "tools.replace",
    runtimePresent: Boolean(wrappedContext),
    runtimeError: wrappedContext ? undefined : runtimeError,
    tools: snapshotTools(),
  });
}

function rememberTool(def, options) {
  if (!def || typeof def.name !== "string") return;
  tools.set(def.name, {
    originalName: def.name,
    description: typeof def.description === "string" ? def.description : undefined,
    inputSchema: def.inputSchema,
    annotations: def.annotations,
    execute: def.execute,
  });
  const signal = options?.signal;
  if (signal && typeof signal.addEventListener === "function") {
    signal.addEventListener(
      "abort",
      () => {
        tools.delete(def.name);
        publishSnapshot();
      },
      { once: true },
    );
  }
}

function wrapContext(ctx) {
  if (!ctx || typeof ctx.registerTool !== "function") return ctx;
  if (ctx.__mcp2webmcpWrapped) return ctx;
  const originalRegister = ctx.registerTool.bind(ctx);
  ctx.registerTool = async function mcp2webmcpRegisterTool(def, options) {
    const result = await originalRegister(def, options);
    rememberTool(def, options);
    publishSnapshot();
    return result;
  };
  if (typeof ctx.unregisterTool === "function") {
    const originalUnregister = ctx.unregisterTool.bind(ctx);
    ctx.unregisterTool = async function mcp2webmcpUnregisterTool(name, ...rest) {
      const result = await originalUnregister(name, ...rest);
      if (typeof name === "string") tools.delete(name);
      publishSnapshot();
      return result;
    };
  }
  ctx.__mcp2webmcpWrapped = true;
  wrappedContext = ctx;
  runtimeError = undefined;
  publishSnapshot();
  return ctx;
}

function intercept(object, property) {
  if (!object) return;
  let current = object[property];
  if (current) wrapContext(current);
  try {
    Object.defineProperty(object, property, {
      configurable: true,
      enumerable: true,
      get() {
        return current;
      },
      set(value) {
        current = wrapContext(value) || value;
      },
    });
  } catch {
    // Native descriptor may be non-configurable; fall back to polling.
  }
}

intercept(navigator, "modelContext");
if (typeof document !== "undefined") {
  intercept(document, "modelContext");
}

function tryAttach() {
  const ctx = document.modelContext || navigator.modelContext;
  if (ctx) wrapContext(ctx);
}

tryAttach();
const poll = setInterval(tryAttach, 50);
window.addEventListener("load", () => {
  tryAttach();
  setTimeout(() => {
    clearInterval(poll);
    if (!wrappedContext) {
      runtimeError = "no-webmcp-runtime";
      publishSnapshot();
    }
  }, 1500);
});

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.channel !== CHANNEL || data.direction !== "isolated-to-page") return;
  if (data.kind === "bridge-ready") {
    publishSnapshot();
    return;
  }
  if (data.kind === "invoke") {
    void runInvoke(data);
    return;
  }
  if (data.kind === "invokeCancel") {
    pendingInvokes.get(data.requestId)?.abort();
  }
});

async function runInvoke(data) {
  const controller = new AbortController();
  pendingInvokes.set(data.requestId, controller);
  const remain = typeof data.deadline === "number" ? Math.max(1, data.deadline - Date.now()) : 60_000;
  const timer = setTimeout(() => controller.abort(), remain);
  try {
    if (!wrappedContext) {
      throw new Error("no-webmcp-runtime");
    }
    const tool = tools.get(data.originalName);
    if (!tool || typeof tool.execute !== "function") {
      throw new Error(`tool not found: ${data.originalName}`);
    }
    const result = await Promise.race([
      Promise.resolve(tool.execute(data.args ?? {})),
      abortPromise(controller.signal),
    ]);
    post({
      kind: "invokeResult",
      requestId: data.requestId,
      ...normalizeResult(result),
    });
  } catch (error) {
    post({
      kind: "invokeResult",
      requestId: data.requestId,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  } finally {
    clearTimeout(timer);
    pendingInvokes.delete(data.requestId);
  }
}

function normalizeResult(value) {
  if (value && typeof value === "object" && Array.isArray(value.content)) {
    return {
      content: value.content,
      structuredContent: value.structuredContent,
      isError: Boolean(value.isError),
    };
  }
  if (typeof value === "string") {
    return { content: [{ type: "text", text: value }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(value ?? null) }] };
}

function abortPromise(signal) {
  return new Promise((_, reject) => {
    const fail = () => reject(new Error("invocation cancelled"));
    if (signal.aborted) {
      fail();
      return;
    }
    signal.addEventListener("abort", fail, { once: true });
  });
}

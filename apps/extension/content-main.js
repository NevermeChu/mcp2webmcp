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

function pageLog(event, data, extra) {
  post({
    kind: "log",
    event,
    level: extra?.level ?? "info",
    message: extra?.message,
    data,
  });
}

const tools = new Map();
let wrappedContext = null;
let runtimeError = "no-webmcp-runtime";
const pendingInvokes = new Map();
let lastSnapshotKey = "";

function snapshotTools() {
  return [...tools.values()].map((entry) => ({
    originalName: entry.originalName,
    description: entry.description,
    inputSchema: entry.inputSchema && typeof entry.inputSchema === "object" ? entry.inputSchema : { type: "object", properties: {} },
    annotations: entry.annotations,
  }));
}

function publishSnapshot() {
  const snapshot = snapshotTools();
  const key = JSON.stringify({
    runtimePresent: Boolean(wrappedContext),
    runtimeError: wrappedContext ? undefined : runtimeError,
    tools: snapshot,
  });
  if (key === lastSnapshotKey) return;
  lastSnapshotKey = key;
  post({
    kind: "tools.replace",
    runtimePresent: Boolean(wrappedContext),
    runtimeError: wrappedContext ? undefined : runtimeError,
    tools: snapshot,
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
    const drop = () => {
      tools.delete(def.name);
      publishSnapshot();
    };
    if (signal.aborted) {
      drop();
      return;
    }
    signal.addEventListener("abort", drop, { once: true });
  }
}

function wrapContext(ctx) {
  // Wrap whoever provided registerTool (native / polyfill / page). Do not create a host here.
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
  pageLog("runtime.wrapped", { toolCount: tools.size });
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
      pageLog("runtime.missing", { reason: "no-webmcp-runtime" }, { level: "warn" });
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

function watchPickerSpec() {
  const root = document.documentElement;
  if (!root) {
    setTimeout(watchPickerSpec, 20);
    return;
  }
  const consume = () => {
    const raw = root.getAttribute("data-mcp2webmcp-pick-spec");
    if (!raw) return;
    root.removeAttribute("data-mcp2webmcp-pick-spec");
    let spec;
    try {
      spec = JSON.parse(raw);
    } catch (error) {
      root.setAttribute("data-mcp2webmcp-bind-error", "invalid picker spec json");
      return;
    }
    void registerFromPicker(spec)
      .then((name) => {
        root.setAttribute("data-mcp2webmcp-bind", name);
        post({ kind: "picker.bindResult", ok: true, name });
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        root.setAttribute("data-mcp2webmcp-bind-error", message);
        pageLog("picker.bind.failed", { error: message }, { level: "error" });
        post({
          kind: "picker.bindResult",
          ok: false,
          error: message,
        });
      });
  };
  new MutationObserver(consume).observe(root, {
    attributes: true,
    attributeFilter: ["data-mcp2webmcp-pick-spec"],
  });
  consume();
}

watchPickerSpec();

async function registerFromPicker(spec) {
  tryAttach();
  if (!wrappedContext) {
    throw new Error("no-webmcp-runtime");
  }
  if (!spec || typeof spec.name !== "string" || !spec.locator) {
    throw new Error("invalid picker spec");
  }
  const name = uniquePickedName(spec.name, new Set(tools.keys()));
  await wrappedContext.registerTool({
    name,
    description: typeof spec.description === "string" ? spec.description : name,
    inputSchema: spec.inputSchema,
    annotations: spec.annotations,
    execute: (args) => executePickedBinding({ ...spec, name }, args),
  });
  pageLog("picker.bound", { name });
  return name;
}

function uniquePickedName(base, taken) {
  const root = String(base)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40) || "element";
  if (!taken.has(root)) return root;
  let i = 2;
  while (taken.has(`${root}_${i}`)) i += 1;
  return `${root}_${i}`;
}

function executePickedBinding(spec, args) {
  const css = spec.locator?.css;
  let el = null;
  try {
    el = typeof css === "string" ? document.querySelector(css) : null;
  } catch {
    el = null;
  }
  if (!el) {
    throw new Error(`element not found: ${css ?? "?"}`);
  }
  const kind = spec.bindKind;
  if (kind === "click") {
    el.click();
    return { content: [{ type: "text", text: `clicked ${spec.label}` }] };
  }
  if (kind === "fill" || kind === "select") {
    const value = args && typeof args.value === "string" ? args.value : "";
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
    } else {
      const proto = el.tagName.toLowerCase() === "textarea" ? HTMLTextAreaElement : HTMLInputElement;
      const desc = Object.getOwnPropertyDescriptor(proto.prototype, "value");
      if (desc && typeof desc.set === "function") desc.set.call(el, value);
      else el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { content: [{ type: "text", text: `set ${spec.label} to ${JSON.stringify(value)}` }] };
  }
  if (kind === "toggle") {
    const next = args && typeof args.checked === "boolean" ? args.checked : !(el.checked === true);
    el.checked = next;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return { content: [{ type: "text", text: `${spec.label} checked=${next}` }] };
  }
  throw new Error(`unsupported bind kind: ${kind}`);
}

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

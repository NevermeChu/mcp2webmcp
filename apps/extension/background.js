const PROTOCOL = "mcp2webmcp-extension";
const PROTOCOL_VERSION = 1;
const DEFAULT_PORT = 9334;

/** @type {number} */
let gatewayPort = DEFAULT_PORT;
/** @type {WebSocket | undefined} */
let socket;
/** @type {boolean} */
let helloOk = false;
/** @type {ReturnType<typeof setInterval> | undefined} */
let pingTimer;
let pingSeq = 0;

/**
 * @typedef {{
 *   origin: string,
 *   url: string,
 *   title?: string,
 *   pageInstanceId?: string,
 *   runtimePresent: boolean,
 *   runtimeError?: string,
 *   tools: unknown[],
 *   generation: number,
 * }} TabState
 */

/** @type {Map<number, TabState>} */
const tabs = new Map();

chrome.sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  ?.catch?.(() => {});

let socketGeneration = 0;
/** @type {Array<Record<string, unknown>>} */
const pendingLogs = [];

/**
 * @typedef {{
 *   id: string,
 *   timestamp: number,
 *   tabId: number,
 *   originalName: string,
 *   args?: unknown,
 *   durationMs: number,
 *   isError: boolean,
 *   error?: string,
 *   resultPreview?: string,
 * }} InvocationRecord
 */

/** @type {InvocationRecord[]} */
const recentInvocations = [];
const MAX_INVOCATIONS = 50;

function notifyExtensionPages(message) {
  try {
    chrome.runtime.sendMessage(message).catch(() => {});
  } catch {
    // ignore
  }
}

function recordInvocation(entry) {
  recentInvocations.unshift(entry);
  if (recentInvocations.length > MAX_INVOCATIONS) {
    recentInvocations.length = MAX_INVOCATIONS;
  }
  notifyExtensionPages({ type: "invocation.stream", record: entry });
}

function updateBadge() {
  chrome.tabs
    ?.query({ active: true, lastFocusedWindow: true })
    .then(([activeTab]) => {
      if (!socket || !helloOk) {
        chrome.action.setBadgeText({ text: "OFF" }).catch?.(() => {});
        chrome.action.setBadgeBackgroundColor({ color: "#ef4444" }).catch?.(() => {});
        chrome.action.setTitle({ title: "WebMCP Gateway: Disconnected" }).catch?.(() => {});
        return;
      }
      if (activeTab?.id && tabs.has(activeTab.id)) {
        const count = tabs.get(activeTab.id)?.tools?.length ?? 0;
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : "0" }).catch?.(() => {});
        chrome.action.setBadgeBackgroundColor({ color: count > 0 ? "#10b981" : "#64748b" }).catch?.(() => {});
        chrome.action.setTitle({ title: `WebMCP Gateway: Connected (${count} tools)` }).catch?.(() => {});
      } else {
        chrome.action.setBadgeText({ text: "" }).catch?.(() => {});
        chrome.action.setTitle({ title: "WebMCP Gateway: Connected" }).catch?.(() => {});
      }
    })
    .catch(() => {});
}

chrome.tabs.onActivated.addListener(() => {
  updateBadge();
  notifyExtensionPages({ type: "state.updated" });
});

globalThis.mcp2webmcpSetGatewayPort = (port) => {
  const next = Number(port);
  if (!Number.isInteger(next) || next <= 0) return;
  gatewayPort = next;
  connect();
};

function sourceIdFor(tabId) {
  return `tab:${tabId}`;
}

function originFromTabUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

function send(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  if (message.type === "log" && !helloOk) {
    pendingLogs.push(message);
    return;
  }
  if (!helloOk && message.type !== "hello") return;
  socket.send(JSON.stringify(message));
}

function gatewayLog(event, data, extra) {
  send({
    type: "log",
    hop: extra?.hop ?? "extension",
    level: extra?.level ?? "info",
    event,
    message: extra?.message,
    traceId: extra?.traceId,
    data,
  });
}

function flushLogs() {
  const queued = pendingLogs.splice(0);
  for (const message of queued) send(message);
}

function connect() {
  const generation = ++socketGeneration;
  helloOk = false;
  if (pingTimer) clearInterval(pingTimer);
  if (socket) {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
  socket = new WebSocket(`ws://127.0.0.1:${gatewayPort}`);
  socket.onopen = () => {
    if (generation !== socketGeneration) return;
    socket?.send(
      JSON.stringify({
        type: "hello",
        protocol: PROTOCOL,
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
  };
  socket.onclose = () => {
    if (generation !== socketGeneration) return;
    helloOk = false;
    updateBadge();
    notifyExtensionPages({ type: "state.updated" });
    setTimeout(() => {
      if (generation === socketGeneration) connect();
    }, 1_500);
  };
  socket.onerror = () => {
    // onclose handles retry
  };
  socket.onmessage = (event) => {
    if (generation !== socketGeneration) return;
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    if (message.type === "helloAck") {
      helloOk = message.protocolVersion === PROTOCOL_VERSION;
      if (helloOk) {
        gatewayLog("extension.helloAck", { port: gatewayPort });
        flushLogs();
        replayAll();
        updateBadge();
        notifyExtensionPages({ type: "state.updated" });
      }
      return;
    }
    if (!helloOk) return;
    if (message.type === "ping") {
      send({ type: "pong", id: message.id });
      return;
    }
    if (message.type === "invoke") {
      void handleInvoke(message);
      return;
    }
    if (message.type === "invokeCancel") {
      const tabId = Number(String(message.sourceId ?? "").replace(/^tab:/, ""));
      if (Number.isInteger(tabId)) {
        void chrome.tabs.sendMessage(tabId, { type: "invokeCancel", requestId: message.requestId }).catch(() => undefined);
      }
    }
  };
  pingTimer = setInterval(() => {
    send({ type: "ping", id: `e${++pingSeq}` });
  }, 20_000);
}

function replayAll() {
  for (const [tabId, state] of tabs) {
    upsert(tabId, state, "connect");
    sendTools(tabId, state);
  }
}

function upsert(tabId, state, reason) {
  send({
    type: "source.upsert",
    sourceId: sourceIdFor(tabId),
    tabId: String(tabId),
    origin: state.origin,
    url: state.url,
    title: state.title,
    reason,
  });
}

function sendTools(tabId, state) {
  send({
    type: "tools.replace",
    sourceId: sourceIdFor(tabId),
    tools: state.tools,
    runtimePresent: state.runtimePresent,
    runtimeError: state.runtimeError,
  });
}

function removeTab(tabId) {
  if (!tabs.has(tabId)) return;
  tabs.delete(tabId);
  send({ type: "source.remove", sourceId: sourceIdFor(tabId) });
  updateBadge();
  notifyExtensionPages({ type: "state.updated" });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  removeTab(tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const url = tab.url ?? changeInfo.url;
  if (!url) return;
  const origin = originFromTabUrl(url);
  const existing = tabs.get(tabId);
  if (!origin) {
    removeTab(tabId);
    return;
  }
  if (existing && changeInfo.status === "complete") {
    const navigated = existing.origin !== origin || existing.url !== url;
    existing.origin = origin;
    existing.url = url;
    existing.title = tab.title;
    if (navigated) {
      existing.generation += 1;
      existing.tools = [];
      existing.pageInstanceId = undefined;
      upsert(tabId, existing, "navigate");
      sendTools(tabId, existing);
    }
    updateBadge();
    notifyExtensionPages({ type: "state.updated" });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "status") {
    chrome.tabs
      ?.query({ active: true, lastFocusedWindow: true })
      .then(([activeTab]) => {
        sendResponse({
          connected: Boolean(helloOk),
          gateway: `ws://127.0.0.1:${gatewayPort}`,
          activeTabId: activeTab?.id,
          invocations: recentInvocations,
          tabs: [...tabs.entries()].map(([tabId, state]) => ({
            tabId,
            origin: state.origin,
            url: state.url,
            title: state.title,
            toolCount: Array.isArray(state.tools) ? state.tools.length : 0,
            tools: Array.isArray(state.tools) ? state.tools : [],
            runtimePresent: state.runtimePresent,
            runtimeError: state.runtimeError,
          })),
        });
      })
      .catch(() => {
        sendResponse({
          connected: Boolean(helloOk),
          gateway: `ws://127.0.0.1:${gatewayPort}`,
          invocations: recentInvocations,
          tabs: [...tabs.entries()].map(([tabId, state]) => ({
            tabId,
            origin: state.origin,
            url: state.url,
            title: state.title,
            toolCount: Array.isArray(state.tools) ? state.tools.length : 0,
            tools: Array.isArray(state.tools) ? state.tools : [],
            runtimePresent: state.runtimePresent,
            runtimeError: state.runtimeError,
          })),
        });
      });
    return true;
  }
  if (message?.type === "gateway.reconnect") {
    connect();
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "tab.activate" && typeof message.tabId === "number") {
    chrome.tabs.update(message.tabId, { active: true }).catch(() => {});
    return undefined;
  }
  if (message?.type === "pick.start") {
    void startPickOnActiveTab().then(
      () => sendResponse({ ok: true }),
      (error) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
    return true;
  }
  if (message?.type === "page.log") {
    gatewayLog(typeof message.event === "string" ? message.event : "page.event", message.data, {
      hop: "page",
      level: message.level,
      message: message.message,
      traceId: message.traceId,
    });
    return undefined;
  }
  if (message?.type !== "page.snapshot") return undefined;
  const tab = sender.tab;
  if (!tab?.id || !tab.url) return undefined;
  const origin = originFromTabUrl(tab.url);
  if (!origin) return undefined;
  const tabId = tab.id;
  const existing = tabs.get(tabId);
  const pageInstanceId = typeof message.pageInstanceId === "string" ? message.pageInstanceId : undefined;
  const tools = Array.isArray(message.tools) ? message.tools : [];
  if (!existing) {
    const state = {
      origin,
      url: tab.url,
      title: tab.title,
      pageInstanceId,
      runtimePresent: Boolean(message.runtimePresent),
      runtimeError: message.runtimeError,
      tools,
      generation: 1,
    };
    tabs.set(tabId, state);
    gatewayLog("page.snapshot", {
      tabId,
      origin,
      count: tools.length,
      names: tools.map((tool) => (tool && typeof tool.originalName === "string" ? tool.originalName : "")).filter(Boolean),
      runtimePresent: state.runtimePresent,
      runtimeError: state.runtimeError,
      reason: "connect",
    });
    upsert(tabId, state, "connect");
    sendTools(tabId, state);
    updateBadge();
    notifyExtensionPages({ type: "state.updated" });
    return undefined;
  }
  const reload = pageInstanceId && existing.pageInstanceId && pageInstanceId !== existing.pageInstanceId;
  const navigated = existing.origin !== origin || existing.url !== tab.url;
  existing.origin = origin;
  existing.url = tab.url;
  existing.title = tab.title;
  existing.runtimePresent = Boolean(message.runtimePresent);
  existing.runtimeError = message.runtimeError;
  existing.tools = tools;
  gatewayLog("page.snapshot", {
    tabId,
    origin,
    count: tools.length,
    names: tools.map((tool) => (tool && typeof tool.originalName === "string" ? tool.originalName : "")).filter(Boolean),
    runtimePresent: existing.runtimePresent,
    runtimeError: existing.runtimeError,
    reload: Boolean(reload),
    navigated,
  });
  if (reload || navigated) {
    existing.generation += 1;
    existing.pageInstanceId = pageInstanceId;
    upsert(tabId, existing, reload ? "reload" : "navigate");
  } else if (!existing.pageInstanceId && pageInstanceId) {
    existing.pageInstanceId = pageInstanceId;
  }
  sendTools(tabId, existing);
  updateBadge();
  notifyExtensionPages({ type: "state.updated" });
  return undefined;
});

async function startPickOnActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab?.id) {
    throw new Error("no active tab");
  }
  const url = tab.url ?? "";
  if (url && !/^https?:/i.test(url)) {
    throw new Error("open an http(s) page first");
  }
  gatewayLog("pick.start", { tabId: tab.id });
  try {
    const result = await chrome.tabs.sendMessage(tab.id, { type: "pick.start" });
    if (result && result.ok === false) {
      gatewayLog("pick.failed", { error: result.error }, { level: "warn" });
      throw new Error(result.error || "could not start picker");
    }
    gatewayLog("pick.overlay", { tabId: tab.id });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    gatewayLog("pick.failed", { error: text }, { level: "error" });
    if (/Receiving end does not exist|message port closed/i.test(text)) {
      throw new Error("Refresh this page, then click Register tool again.");
    }
    throw error instanceof Error ? error : new Error(text);
  }
}

async function handleInvoke(message) {
  const startedAt = Date.now();
  const tabId = Number(String(message.sourceId ?? "").replace(/^tab:/, ""));
  gatewayLog(
    "invoke.forward",
    { sourceId: message.sourceId, originalName: message.originalName },
    { traceId: message.requestId },
  );
  if (!Number.isInteger(tabId) || tabId < 0) {
    const errorMsg = "invalid sourceId";
    recordInvocation({
      id: message.requestId,
      timestamp: Date.now(),
      tabId,
      originalName: message.originalName,
      args: message.args,
      durationMs: Date.now() - startedAt,
      isError: true,
      error: errorMsg,
    });
    send({
      type: "invokeResult",
      requestId: message.requestId,
      sourceId: message.sourceId,
      content: [{ type: "text", text: errorMsg }],
      isError: true,
      error: { message: errorMsg },
    });
    return;
  }
  try {
    const result = await chrome.tabs.sendMessage(tabId, {
      type: "invoke",
      requestId: message.requestId,
      originalName: message.originalName,
      args: message.args,
      deadline: message.deadline,
    });
    const durationMs = Date.now() - startedAt;
    const textPreview = typeof result?.content?.[0]?.text === "string" ? result.content[0].text.slice(0, 150) : undefined;
    recordInvocation({
      id: message.requestId,
      timestamp: Date.now(),
      tabId,
      originalName: message.originalName,
      args: message.args,
      durationMs,
      isError: Boolean(result?.isError),
      error: result?.error?.message,
      resultPreview: textPreview,
    });
    send({
      type: "invokeResult",
      requestId: message.requestId,
      sourceId: message.sourceId,
      content: result?.content ?? [],
      structuredContent: result?.structuredContent,
      isError: Boolean(result?.isError),
      error: result?.error,
    });
    gatewayLog(
      result?.isError ? "invoke.page.error" : "invoke.page.result",
      { isError: Boolean(result?.isError) },
      { level: result?.isError ? "warn" : "info", traceId: message.requestId },
    );
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorMsg = error instanceof Error ? error.message : String(error);
    recordInvocation({
      id: message.requestId,
      timestamp: Date.now(),
      tabId,
      originalName: message.originalName,
      args: message.args,
      durationMs,
      isError: true,
      error: errorMsg,
    });
    gatewayLog(
      "invoke.page.failed",
      { error: errorMsg },
      { level: "error", traceId: message.requestId },
    );
    send({
      type: "invokeResult",
      requestId: message.requestId,
      sourceId: message.sourceId,
      content: [{ type: "text", text: errorMsg }],
      isError: true,
      error: { message: errorMsg },
    });
  }
}

connect();

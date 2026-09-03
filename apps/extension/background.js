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

let socketGeneration = 0;

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
  if (!socket || socket.readyState !== WebSocket.OPEN || !helloOk) return;
  socket.send(JSON.stringify(message));
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
      if (helloOk) replayAll();
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
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "status") {
    sendResponse({
      connected: Boolean(helloOk),
      gateway: `ws://127.0.0.1:${gatewayPort}`,
      tabs: [...tabs.entries()].map(([tabId, state]) => ({
        tabId,
        origin: state.origin,
        toolCount: Array.isArray(state.tools) ? state.tools.length : 0,
        runtimePresent: state.runtimePresent,
        runtimeError: state.runtimeError,
      })),
    });
    return true;
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
    upsert(tabId, state, "connect");
    sendTools(tabId, state);
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
  if (reload || navigated) {
    existing.generation += 1;
    existing.pageInstanceId = pageInstanceId;
    upsert(tabId, existing, reload ? "reload" : "navigate");
  } else if (!existing.pageInstanceId && pageInstanceId) {
    existing.pageInstanceId = pageInstanceId;
  }
  sendTools(tabId, existing);
  return undefined;
});

async function handleInvoke(message) {
  const tabId = Number(String(message.sourceId ?? "").replace(/^tab:/, ""));
  if (!Number.isInteger(tabId) || tabId < 0) {
    send({
      type: "invokeResult",
      requestId: message.requestId,
      sourceId: message.sourceId,
      content: [{ type: "text", text: "invalid sourceId" }],
      isError: true,
      error: { message: "invalid sourceId" },
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
    send({
      type: "invokeResult",
      requestId: message.requestId,
      sourceId: message.sourceId,
      content: result?.content ?? [],
      structuredContent: result?.structuredContent,
      isError: Boolean(result?.isError),
      error: result?.error,
    });
  } catch (error) {
    send({
      type: "invokeResult",
      requestId: message.requestId,
      sourceId: message.sourceId,
      content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
      isError: true,
      error: { message: error instanceof Error ? error.message : String(error) },
    });
  }
}

connect();

const CHANNEL = "mcp2webmcp-ext";
const pending = new Map();

function originOk(event) {
  return event.source === window && event.origin === window.location.origin;
}

window.addEventListener("message", (event) => {
  if (!originOk(event)) return;
  const data = event.data;
  if (!data || data.channel !== CHANNEL || data.direction !== "page-to-isolated") return;
  if (data.kind === "invokeResult") {
    const waiter = pending.get(data.requestId);
    if (waiter) {
      pending.delete(data.requestId);
      waiter(data);
    }
    return;
  }
  if (data.kind === "tools.replace") {
    void chrome.runtime.sendMessage({
      type: "page.snapshot",
      pageInstanceId: data.pageInstanceId,
      runtimePresent: data.runtimePresent,
      runtimeError: data.runtimeError,
      tools: data.tools,
    });
  }
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "invoke") {
    const requestId = message.requestId;
    const timer = setTimeout(() => {
      if (pending.has(requestId)) {
        pending.delete(requestId);
        sendResponse({
          requestId,
          content: [{ type: "text", text: "invocation timeout" }],
          isError: true,
          error: { message: "invocation timeout" },
        });
      }
    }, Math.max(1, (message.deadline ?? Date.now() + 60_000) - Date.now()));
    pending.set(requestId, (result) => {
      clearTimeout(timer);
      sendResponse({
        requestId,
        content: result.content,
        structuredContent: result.structuredContent,
        isError: result.isError,
        error: result.error,
      });
    });
    window.postMessage(
      {
        channel: CHANNEL,
        direction: "isolated-to-page",
        kind: "invoke",
        requestId,
        originalName: message.originalName,
        args: message.args,
        deadline: message.deadline,
      },
      window.location.origin,
    );
    return true;
  }
  if (message?.type === "invokeCancel") {
    window.postMessage(
      {
        channel: CHANNEL,
        direction: "isolated-to-page",
        kind: "invokeCancel",
        requestId: message.requestId,
      },
      window.location.origin,
    );
  }
  return undefined;
});

window.postMessage(
  { channel: CHANNEL, direction: "isolated-to-page", kind: "bridge-ready" },
  window.location.origin,
);

setInterval(() => {
  window.postMessage(
    { channel: CHANNEL, direction: "isolated-to-page", kind: "bridge-ready" },
    window.location.origin,
  );
}, 3_000);

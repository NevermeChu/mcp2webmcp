const CHANNEL = "mcp2webmcp-ext";
const pending = new Map();
/** @type {((data: { ok?: boolean, name?: string, error?: string }) => void) | undefined} */
let pendingBind;
/** @type {{ host: HTMLElement, shadow: ShadowRoot, highlight: HTMLElement, tooltip: HTMLElement, banner: HTMLElement } | undefined} */
let pickUi;
let pickCursor = "";

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
    return;
  }
  if (data.kind === "picker.bindResult") {
    const waiter = pendingBind;
    pendingBind = undefined;
    waiter?.(data);
    return;
  }
  if (data.kind === "log") {
    void chrome.runtime.sendMessage({
      type: "page.log",
      hop: "page",
      event: data.event,
      level: data.level,
      message: data.message,
      data: data.data,
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
  if (message?.type === "pick.start") {
    try {
      if (!globalThis.mcp2webmcpPicker) {
        sendResponse({ ok: false, error: "picker model missing" });
        return true;
      }
      startPick();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
  }
  if (message?.type === "pick.cancel") {
    try {
      stopPick();
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return true;
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

function startPick() {
  if (pickUi) stopPick();
  const picker = globalThis.mcp2webmcpPicker;
  if (!picker) return;

  const host = document.createElement("div");
  host.id = "mcp2webmcp-picker-host";
  host.setAttribute("data-mcp2webmcp-picker", "1");
  host.style.cssText =
    "all:initial;position:fixed;top:0;left:0;width:0;height:0;overflow:visible;z-index:2147483646;pointer-events:none;";
  const shadow = host.attachShadow({ mode: "closed" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      #banner {
        pointer-events: auto;
        position: fixed;
        top: 8px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 2;
        font: 12px/1.4 system-ui, sans-serif;
        color: #fff;
        background: #1a1a1a;
        padding: 8px 12px;
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0,0,0,.35);
        white-space: nowrap;
      }
      #banner button {
        margin-left: 10px;
        font: inherit;
        cursor: pointer;
      }
      #highlight {
        position: fixed;
        pointer-events: none;
        border: 2px solid #4c8bf5;
        background: rgba(76, 139, 245, 0.16);
        box-sizing: border-box;
        display: none;
      }
      #highlight.invalid { border-color: #888; background: rgba(0,0,0,.06); }
      #tooltip {
        position: fixed;
        pointer-events: none;
        display: none;
        font: 11px/1.3 ui-monospace, monospace;
        color: #fff;
        background: #4c8bf5;
        padding: 3px 6px;
        border-radius: 3px;
        max-width: 28rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    </style>
    <div id="banner"><span id="msg">Click a button or input to register it as a tool</span> <button type="button" id="cancel">Esc</button></div>
    <div id="highlight"></div>
    <div id="tooltip"></div>
  `;
  const highlight = shadow.getElementById("highlight");
  const tooltip = shadow.getElementById("tooltip");
  const banner = shadow.getElementById("banner");
  shadow.getElementById("cancel")?.addEventListener("click", () => stopPick());
  document.documentElement.append(host);
  pickCursor = document.documentElement.style.cursor;
  document.documentElement.style.cursor = "crosshair";
  pickUi = { host, shadow, highlight, tooltip, banner };

  document.addEventListener("mousemove", onPickMove, true);
  document.addEventListener("pointerdown", onPickClick, true);
  document.addEventListener("click", onPickClick, true);
  document.addEventListener("keydown", onPickKey, true);
  document.addEventListener("scroll", onPickScroll, true);
}

function stopPick() {
  if (!pickUi) return;
  document.removeEventListener("mousemove", onPickMove, true);
  document.removeEventListener("pointerdown", onPickClick, true);
  document.removeEventListener("click", onPickClick, true);
  document.removeEventListener("keydown", onPickKey, true);
  document.removeEventListener("scroll", onPickScroll, true);
  pickUi.host.remove();
  document.documentElement.style.cursor = pickCursor;
  pickUi = undefined;
  pendingBind = undefined;
  pickBusy = false;
}

function isPickerHost(node) {
  return Boolean(node && (node.id === "mcp2webmcp-picker-host" || node.closest?.("#mcp2webmcp-picker-host")));
}

function bindableFromPoint(x, y) {
  const picker = globalThis.mcp2webmcpPicker;
  const stack = document.elementsFromPoint(x, y);
  for (const node of stack) {
    if (isPickerHost(node)) continue;
    const bindable = picker.closestBindable(node);
    if (bindable) return bindable;
  }
  return null;
}

/** @type {Element | null} */
let hovered = null;

function onPickMove(event) {
  if (!pickUi) return;
  if (isPickerHost(event.target)) return;
  const picker = globalThis.mcp2webmcpPicker;
  const bindable = picker.closestBindable(event.target);
  hovered = bindable || (event.target instanceof Element ? event.target : null);
  paintHover();
}

function onPickScroll() {
  paintHover();
}

function paintHover() {
  if (!pickUi || !hovered || !hovered.getBoundingClientRect) {
    if (pickUi) {
      pickUi.highlight.style.display = "none";
      pickUi.tooltip.style.display = "none";
    }
    return;
  }
  const picker = globalThis.mcp2webmcpPicker;
  const rect = hovered.getBoundingClientRect();
  const ok = picker.isBindable(hovered);
  const box = pickUi.highlight;
  box.classList.toggle("invalid", !ok);
  box.style.display = "block";
  box.style.top = `${rect.top}px`;
  box.style.left = `${rect.left}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;
  const tip = pickUi.tooltip;
  const proposed = ok ? picker.proposeTool(hovered) : null;
  tip.textContent = proposed ? proposed.name : hovered.tagName.toLowerCase();
  tip.style.display = "block";
  tip.style.top = `${Math.max(0, rect.top - 22)}px`;
  tip.style.left = `${Math.max(0, rect.left)}px`;
}

function onPickKey(event) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    stopPick();
  }
}

let pickBusy = false;

function onPickClick(event) {
  if (!pickUi) return;
  if (isPickerHost(event.target)) return;
  const picker = globalThis.mcp2webmcpPicker;
  const el = bindableFromPoint(event.clientX, event.clientY) || picker.closestBindable(event.target);
  if (!el) return;
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  if (pickBusy) return;
  pickBusy = true;
  const proposed = picker.proposeTool(el);
  const spec = {
    ...proposed,
    locator: picker.buildLocator(el),
  };
  const msg = pickUi.shadow.getElementById("msg");
  pendingBind = (result) => {
    pickBusy = false;
    if (!result?.ok) {
      if (msg) msg.textContent = `Bind failed: ${result?.error ?? "unknown"}`;
      return;
    }
    stopPick();
  };
  window.setTimeout(() => {
    if (pendingBind) pendingBind({ ok: false, error: "timeout" });
  }, 4_000);
  document.documentElement.setAttribute("data-mcp2webmcp-pick-spec", JSON.stringify(spec));
}

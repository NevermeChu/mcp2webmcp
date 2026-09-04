chrome.runtime.sendMessage({ type: "status" }, (status) => {
  const statusEl = document.getElementById("status");
  const gatewayEl = document.getElementById("gateway");
  const tabsEl = document.getElementById("tabs");
  if (chrome.runtime.lastError || !status) {
    statusEl.textContent = "background unavailable";
    statusEl.className = "bad";
    return;
  }
  statusEl.textContent = status.connected ? "connected to Gateway" : "not connected";
  statusEl.className = status.connected ? "ok" : "bad";
  gatewayEl.textContent = status.gateway ?? "";
  tabsEl.replaceChildren();
  for (const tab of status.tabs ?? []) {
    const item = document.createElement("li");
    const runtime = tab.runtimePresent
      ? `${tab.toolCount} tools`
      : tab.runtimeError || "no-webmcp-runtime";
    item.textContent = `${tab.origin} — ${runtime}`;
    tabsEl.append(item);
  }
  if ((status.tabs ?? []).length === 0) {
    const item = document.createElement("li");
    item.textContent = "no WebMCP tabs yet";
    tabsEl.append(item);
  }
});

document.getElementById("register-tool")?.addEventListener("click", () => {
  const errorEl = document.getElementById("pick-error");
  chrome.runtime.sendMessage({ type: "pick.start" }, (result) => {
    if (chrome.runtime.lastError || !result?.ok) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent =
          result?.error ||
          chrome.runtime.lastError?.message ||
          "could not start picker";
      }
      return;
    }
    window.close();
  });
});

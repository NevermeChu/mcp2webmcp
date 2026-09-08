const I18N = {
  zh: {
    status_checking: "检查中…",
    status_connected: "已连接",
    status_disconnected: "未连接",
    gateway_offline_title: "网关未连接",
    reconnect_btn: "重新连接",
    gateway_offline_hint: "请确保本机 Gateway 服务正在运行：",
    copy: "复制",
    copied: "已复制!",
    register_tool: "✨ 拾取页面元素生成工具",
    refresh: "刷新状态",
    active_tab: "当前页面",
    tools_suffix: "个工具",
    loading: "加载中…",
    no_page_detected: "未检测到 WebMCP 页面",
    open_http_hint: "请在 http(s) 网页中使用",
    runtime_inactive: "未激活",
    runtime_active: "Runtime 就绪",
    runtime_none: "无 Runtime",
    page_tools_title: "页面已暴露工具",
    empty_tools:
      "当前页面暂无注册工具。<br>点击上方 <strong>拾取页面元素生成工具</strong>，可将网页按钮或表单转化为 AI 工具。",
    tag_destructive: "破坏性",
    tag_readonly: "只读",
    tag_idempotent: "幂等",
    schema_summary: "入参 Schema (JSON)",
    no_desc: "未提供描述",
    live_invocations: "实时调用记录",
    calls_suffix: "次调用",
    waiting_invocations: "等待 AI Agent 调用页面工具…",
    error_prefix: "调用失败: ",
    other_tabs: "其他 WebMCP 标签页",
    no_other_tabs: "无其他打开的 WebMCP 页面。",
    switch_tab: "切换",
    pick_error_fallback: "无法启动拾取器，请刷新页面后重试。",
    auth_settings: "Gateway 鉴权令牌",
    auth_hint: "必填；须与 Gateway 的 browser.extension.authToken 或环境变量一致。保存后自动重连。",
    auth_saved: "已保存，重连中…",
    auth_cleared: "已清除",
    lang_btn: "EN",
  },
  en: {
    status_checking: "Checking…",
    status_connected: "Connected",
    status_disconnected: "Disconnected",
    gateway_offline_title: "Gateway Offline",
    reconnect_btn: "Reconnect",
    gateway_offline_hint: "Make sure Gateway loopback server is running:",
    copy: "Copy",
    copied: "Copied!",
    register_tool: "✨ Pick Element to Tool",
    refresh: "Refresh state",
    active_tab: "Active Tab",
    tools_suffix: "tools",
    loading: "Loading…",
    no_page_detected: "No WebMCP page detected",
    open_http_hint: "Open an http(s) page to start",
    runtime_inactive: "Inactive",
    runtime_active: "Runtime Active",
    runtime_none: "No Runtime",
    page_tools_title: "Page Tools",
    empty_tools:
      "No tools registered on this page yet.<br>Click <strong>Pick Element to Tool</strong> above to expose buttons or forms to AI.",
    tag_destructive: "Destructive",
    tag_readonly: "ReadOnly",
    tag_idempotent: "Idempotent",
    schema_summary: "Input Schema (JSON)",
    no_desc: "No description provided",
    live_invocations: "Live Invocations",
    calls_suffix: "calls",
    waiting_invocations: "Waiting for AI agent tool invocations…",
    error_prefix: "Error: ",
    other_tabs: "Other WebMCP Tabs",
    no_other_tabs: "No other WebMCP tabs open.",
    switch_tab: "Switch",
    pick_error_fallback: "Could not start element picker. Please refresh the page.",
    auth_settings: "Gateway Auth Token",
    auth_hint:
      "Required; must match browser.extension.authToken or MCP2WEBMCP_EXTENSION_TOKEN. Saving reconnects automatically.",
    auth_saved: "Saved, reconnecting…",
    auth_cleared: "Cleared",
    lang_btn: "中",
  },
};

let currentLang = localStorage.getItem("mcp2webmcp_lang") || "zh";
let lastStatus = null;

function t(key) {
  return I18N[currentLang]?.[key] || I18N.zh[key] || key;
}

function applyStaticI18n() {
  document.documentElement.lang = currentLang === "zh" ? "zh-CN" : "en";
  const btn = document.getElementById("lang-toggle-btn");
  if (btn) btn.textContent = t("lang_btn");

  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    if (key && I18N[currentLang]?.[key]) {
      el.textContent = I18N[currentLang][key];
    }
  });

  const refreshBtn = document.getElementById("refresh-btn");
  if (refreshBtn) refreshBtn.title = t("refresh");
}

function escapeHtml(str) {
  if (typeof str !== "string") return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDuration(ms) {
  if (typeof ms !== "number" || isNaN(ms)) return "";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}

function formatTime(timestamp) {
  try {
    const d = new Date(timestamp);
    return d.toTimeString().split(" ")[0];
  } catch {
    return "";
  }
}

function renderGatewayStatus(status) {
  const pill = document.getElementById("status-pill");
  const text = document.getElementById("status-text");
  const banner = document.getElementById("offline-banner");

  if (!status || !status.connected) {
    pill.className = "status-pill disconnected";
    text.textContent = t("status_disconnected");
    if (banner) banner.hidden = false;
  } else {
    pill.className = "status-pill connected";
    text.textContent = status.gateway
      ? status.gateway.replace(/^ws:\/\//, "")
      : t("status_connected");
    if (banner) banner.hidden = true;
  }
}

function renderActiveTab(activeTab) {
  const titleEl = document.getElementById("active-tab-title");
  const originEl = document.getElementById("active-tab-origin");
  const runtimeEl = document.getElementById("active-tab-runtime");
  const toolsCountEl = document.getElementById("active-tools-count");
  const toolsContainer = document.getElementById("tools-container");

  if (!activeTab) {
    titleEl.textContent = t("no_page_detected");
    originEl.textContent = t("open_http_hint");
    runtimeEl.className = "pill";
    runtimeEl.textContent = t("runtime_inactive");
    toolsCountEl.textContent = `0 ${t("tools_suffix")}`;
    toolsContainer.innerHTML = `<div class="empty-state">${t("open_http_hint")}</div>`;
    return;
  }

  titleEl.textContent = activeTab.title || activeTab.origin || "Untitled Tab";
  titleEl.title = activeTab.title || activeTab.url || "";
  originEl.textContent = activeTab.origin || "";

  if (activeTab.runtimePresent) {
    runtimeEl.className = "pill pill-native";
    runtimeEl.textContent = t("runtime_active");
  } else {
    runtimeEl.className = "pill pill-error";
    runtimeEl.textContent = activeTab.runtimeError || t("runtime_none");
  }

  const tools = Array.isArray(activeTab.tools) ? activeTab.tools : [];
  toolsCountEl.textContent = `${tools.length} ${t("tools_suffix")}`;

  if (tools.length === 0) {
    toolsContainer.innerHTML = `<div class="empty-state">${t("empty_tools")}</div>`;
    return;
  }

  toolsContainer.innerHTML = tools
    .map((tool) => {
      const name = escapeHtml(tool.originalName || "unnamed");
      const desc = escapeHtml(tool.description || t("no_desc"));
      const isDestructive = Boolean(tool.annotations?.destructiveHint);
      const isReadOnly = Boolean(tool.annotations?.readOnlyHint);
      const isIdempotent = Boolean(tool.annotations?.idempotentHint);

      let badges = "";
      if (isDestructive)
        badges += `<span class="tag tag-destructive">${t("tag_destructive")}</span>`;
      if (isReadOnly) badges += `<span class="tag tag-readonly">${t("tag_readonly")}</span>`;
      if (isIdempotent) badges += `<span class="tag tag-idempotent">${t("tag_idempotent")}</span>`;

      let schemaHtml = "";
      if (tool.inputSchema && typeof tool.inputSchema === "object") {
        const schemaPretty = escapeHtml(JSON.stringify(tool.inputSchema, null, 2));
        schemaHtml = `
          <details class="schema-details">
            <summary>${t("schema_summary")}</summary>
            <pre class="schema-box">${schemaPretty}</pre>
          </details>`;
      }

      return `
        <div class="tool-item">
          <div class="tool-header">
            <span class="tool-name">${name}</span>
            <div class="tool-badges">${badges}</div>
          </div>
          <div class="tool-desc">${desc}</div>
          ${schemaHtml}
        </div>`;
    })
    .join("");
}

function renderInvocations(invocations) {
  const container = document.getElementById("invocations-container");
  const countEl = document.getElementById("inv-count");

  const list = Array.isArray(invocations) ? invocations : [];
  countEl.textContent = `${list.length} ${t("calls_suffix")}`;

  if (list.length === 0) {
    container.innerHTML = `<div class="empty-state">${t("waiting_invocations")}</div>`;
    return;
  }

  container.innerHTML = list
    .slice(0, 20)
    .map((inv) => {
      const timeStr = formatTime(inv.timestamp);
      const durationStr = formatDuration(inv.durationMs);
      const isErr = Boolean(inv.isError);
      const name = escapeHtml(inv.originalName || "tool");
      const errorMsg = inv.error ? escapeHtml(inv.error) : "";
      const resultPreview = inv.resultPreview ? escapeHtml(inv.resultPreview) : "";

      let bodyText = "";
      if (isErr) {
        bodyText = `<span style="color: var(--danger-text);">${t("error_prefix")}${errorMsg || "failed"}</span>`;
      } else if (resultPreview) {
        bodyText = `Result: ${resultPreview}`;
      } else if (inv.args && typeof inv.args === "object") {
        bodyText = `Args: ${escapeHtml(JSON.stringify(inv.args))}`;
      }

      return `
        <div class="inv-item ${isErr ? "error" : ""}">
          <div class="inv-header">
            <span class="inv-name">${name}</span>
            <span class="inv-meta">${timeStr} · ${durationStr}</span>
          </div>
          <div class="inv-body">${bodyText}</div>
        </div>`;
    })
    .join("");
}

function renderOtherTabs(allTabs, activeTabId) {
  const countEl = document.getElementById("other-tabs-count");
  const container = document.getElementById("other-tabs-container");

  const others = (allTabs || []).filter((t) => t.tabId !== activeTabId);
  countEl.textContent = String(others.length);

  if (others.length === 0) {
    container.innerHTML = `<div class="empty-state" style="padding: 8px;">${t("no_other_tabs")}</div>`;
    return;
  }

  container.innerHTML = others
    .map((tab) => {
      const title = escapeHtml(tab.title || tab.origin || "Tab");
      const origin = escapeHtml(tab.origin || "");
      const count = Array.isArray(tab.tools) ? tab.tools.length : tab.toolCount || 0;

      return `
        <div class="tab-item">
          <div class="tab-item-info">
            <div class="tab-item-title">${title}</div>
            <div class="tab-item-origin">${origin} · ${count} ${t("tools_suffix")}</div>
          </div>
          <button type="button" class="btn btn-icon switch-tab-btn" data-tab-id="${tab.tabId}" style="padding: 3px 8px; font-size: 11px;">
            ${t("switch_tab")}
          </button>
        </div>`;
    })
    .join("");

  container.querySelectorAll(".switch-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tabId = Number(btn.getAttribute("data-tab-id"));
      if (Number.isInteger(tabId)) {
        chrome.runtime.sendMessage({ type: "tab.activate", tabId });
      }
    });
  });
}

function renderAll(status) {
  lastStatus = status;
  if (!status) {
    renderGatewayStatus(null);
    renderActiveTab(null);
    renderInvocations([]);
    renderOtherTabs([], null);
    return;
  }

  renderGatewayStatus(status);

  const activeId = status.activeTabId;
  const tabsList = status.tabs || [];
  let activeTab = tabsList.find((t) => t.tabId === activeId);

  if (!activeTab && tabsList.length > 0) {
    activeTab = tabsList[0];
  }

  renderActiveTab(activeTab);
  renderInvocations(status.invocations);
  renderOtherTabs(tabsList, activeTab ? activeTab.tabId : activeId);
}

async function fetchStatus() {
  chrome.runtime.sendMessage({ type: "status" }, (status) => {
    if (chrome.runtime.lastError || !status) {
      renderAll(null);
      return;
    }
    renderAll(status);
  });
}

// Initialize language & UI
applyStaticI18n();
fetchStatus();

// Polling interval
setInterval(fetchStatus, 2000);

// Reactive updates
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "state.updated" || message?.type === "invocation.stream") {
    fetchStatus();
  }
});

// Action: Language toggle button
document.getElementById("lang-toggle-btn")?.addEventListener("click", () => {
  currentLang = currentLang === "zh" ? "en" : "zh";
  localStorage.setItem("mcp2webmcp_lang", currentLang);
  applyStaticI18n();
  renderAll(lastStatus);
});

// Action: Register tool
document.getElementById("register-tool")?.addEventListener("click", () => {
  const errorEl = document.getElementById("pick-error");
  if (errorEl) errorEl.hidden = true;

  chrome.runtime.sendMessage({ type: "pick.start" }, (result) => {
    if (chrome.runtime.lastError || !result?.ok) {
      if (errorEl) {
        errorEl.hidden = false;
        errorEl.textContent =
          result?.error || chrome.runtime.lastError?.message || t("pick_error_fallback");
      }
    }
  });
});

// Action: Refresh button
document.getElementById("refresh-btn")?.addEventListener("click", () => {
  fetchStatus();
});

// Action: Reconnect button
document.getElementById("reconnect-btn")?.addEventListener("click", () => {
  chrome.runtime.sendMessage({ type: "gateway.reconnect" }, () => {
    setTimeout(fetchStatus, 300);
  });
});

// Action: Copy command
document.getElementById("copy-cmd-btn")?.addEventListener("click", () => {
  const text = document.getElementById("cmd-text")?.textContent || "";
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById("copy-cmd-btn");
    if (btn) {
      btn.textContent = t("copied");
      setTimeout(() => {
        btn.textContent = t("copy");
      }, 1500);
    }
  });
});

// Action: Gateway auth token (background reconnects via storage.onChanged)
const tokenInput = document.getElementById("auth-token-input");
const tokenStatus = document.getElementById("auth-token-status");
try {
  chrome.storage?.local?.get("gatewayAuthToken", (stored) => {
    const token = stored?.gatewayAuthToken;
    if (typeof token === "string" && tokenInput) tokenInput.value = token;
  });
} catch {
  // storage unavailable (e.g. non-extension context); leave the field empty
}
document.getElementById("auth-token-save")?.addEventListener("click", () => {
  const value = (tokenInput?.value ?? "").trim();
  try {
    if (value) void chrome.storage?.local?.set({ gatewayAuthToken: value });
    else void chrome.storage?.local?.remove("gatewayAuthToken");
    if (tokenStatus) tokenStatus.textContent = t("auth_saved");
  } catch {
    if (tokenStatus) tokenStatus.textContent = "storage error";
  }
});
document.getElementById("auth-token-clear")?.addEventListener("click", () => {
  if (tokenInput) tokenInput.value = "";
  try {
    void chrome.storage?.local?.remove("gatewayAuthToken");
    if (tokenStatus) tokenStatus.textContent = t("auth_cleared");
  } catch {
    if (tokenStatus) tokenStatus.textContent = "storage error";
  }
});

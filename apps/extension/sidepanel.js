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
    register_tool: "＋ 从页面创建",
    refresh: "刷新状态",
    active_tab: "当前页面",
    tools_suffix: "个工具",
    metric_tools: "可用工具",
    metric_calls: "最近调用",
    tools_tab: "工具",
    activity_tab: "活动",
    loading: "加载中…",
    no_page_detected: "未检测到 WebMCP 页面",
    open_http_hint: "请在 http(s) 网页中使用",
    runtime_inactive: "未激活",
    runtime_active: "Runtime 就绪",
    runtime_none: "无 Runtime",
    empty_tools_short: "当前页面暂无注册工具。",
    tool_available: "可用",
    tool_confirm: "需确认",
    schema_summary: "入参 Schema (JSON)",
    no_desc: "未提供描述",
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
    save: "保存",
    clear: "清除",
    local_only: "仅连接本机",
    connection_settings: "连接设置",
    policy_deny: "禁止",
    policy_label: "调用策略",
    policy_allow_option: "允许",
    policy_confirm_option: "每次确认",
    policy_deny_option: "禁止",
    confirmation_heading: "等待确认",
    confirmation_allow: "仅本次允许",
    confirmation_deny: "拒绝",
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
    register_tool: "＋ Create from Page",
    refresh: "Refresh state",
    active_tab: "Active Tab",
    tools_suffix: "tools",
    metric_tools: "Available tools",
    metric_calls: "Recent calls",
    tools_tab: "Tools",
    activity_tab: "Activity",
    loading: "Loading…",
    no_page_detected: "No WebMCP page detected",
    open_http_hint: "Open an http(s) page to start",
    runtime_inactive: "Inactive",
    runtime_active: "Runtime Active",
    runtime_none: "No Runtime",
    empty_tools_short: "No tools registered on this page.",
    tool_available: "Available",
    tool_confirm: "Confirm",
    policy_deny: "Blocked",
    policy_label: "Invocation policy",
    policy_allow_option: "Allow",
    policy_confirm_option: "Confirm each time",
    policy_deny_option: "Block",
    confirmation_heading: "Confirmation required",
    confirmation_allow: "Allow once",
    confirmation_deny: "Deny",
    schema_summary: "Input Schema (JSON)",
    no_desc: "No description provided",
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
    save: "Save",
    clear: "Clear",
    local_only: "Local only",
    connection_settings: "Connection settings",
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
    pill.title = "";
    if (banner) banner.hidden = false;
  } else {
    pill.className = "status-pill connected";
    text.textContent = t("status_connected");
    pill.title = status.gateway || "";
    if (banner) banner.hidden = true;
  }
}

function renderActiveTab(activeTab) {
  const titleEl = document.getElementById("active-tab-title");
  const originEl = document.getElementById("active-tab-origin");
  const runtimeEl = document.getElementById("active-tab-runtime");
  const toolsCountEl = document.getElementById("active-tools-count");
  const toolsTabCountEl = document.getElementById("tools-tab-count");
  const toolsContainer = document.getElementById("tools-container");

  if (!activeTab) {
    titleEl.textContent = t("no_page_detected");
    originEl.textContent = t("open_http_hint");
    runtimeEl.className = "runtime-state";
    runtimeEl.textContent = t("runtime_inactive");
    toolsCountEl.textContent = "0";
    toolsTabCountEl.textContent = "0";
    toolsContainer.innerHTML = `<div class="empty-state">${t("open_http_hint")}</div>`;
    return;
  }

  titleEl.textContent = activeTab.title || activeTab.origin || "Untitled Tab";
  titleEl.title = activeTab.title || activeTab.url || "";
  originEl.textContent = activeTab.origin || "";

  if (activeTab.runtimePresent) {
    runtimeEl.className = "runtime-state ready";
    runtimeEl.textContent = t("runtime_active");
  } else {
    runtimeEl.className = "runtime-state error";
    runtimeEl.textContent = activeTab.runtimeError || t("runtime_none");
  }

  const tools = Array.isArray(activeTab.tools) ? activeTab.tools : [];
  toolsCountEl.textContent = String(tools.length);
  toolsTabCountEl.textContent = String(tools.length);

  if (tools.length === 0) {
    toolsContainer.innerHTML = `<div class="empty-state">${t("empty_tools_short")}</div>`;
    return;
  }

  toolsContainer.innerHTML = tools
    .map((tool) => {
      const rawName = tool.originalName || "unnamed";
      const name = escapeHtml(rawName);
      const desc = escapeHtml(tool.description || t("no_desc"));
      const mode = ["allow", "confirm", "deny"].includes(tool.policyMode)
        ? tool.policyMode
        : "allow";
      const badge =
        mode === "confirm"
          ? `<span class="tag tag-destructive">${t("tool_confirm")}</span>`
          : mode === "deny"
            ? `<span class="tag tag-destructive">${t("policy_deny")}</span>`
            : `<span class="tag tag-readonly">${t("tool_available")}</span>`;

      let schemaHtml = "";
      if (tool.inputSchema && typeof tool.inputSchema === "object") {
        const schemaPretty = escapeHtml(JSON.stringify(tool.inputSchema, null, 2));
        schemaHtml = `<div class="schema-label">${t("schema_summary")}</div>
          <pre class="schema-box">${schemaPretty}</pre>`;
      }

      return `
        <article class="tool-item">
          <button type="button" class="tool-summary" aria-expanded="false">
            <span class="tool-icon">${escapeHtml(rawName.slice(0, 1).toUpperCase())}</span>
            <span class="tool-copy">
              <span class="tool-name">${name}</span>
              <span class="tool-desc">${desc}</span>
            </span>
            <span class="tool-badges">${badge}<span class="tool-chevron">⌄</span></span>
          </button>
          <div class="tool-details">
            <div class="policy-row">
              <label class="policy-label">${t("policy_label")}</label>
              <select class="policy-select" data-origin="${escapeHtml(activeTab.origin || "")}" data-tool="${name}">
                <option value="allow" ${mode === "allow" ? "selected" : ""}>${t("policy_allow_option")}</option>
                <option value="confirm" ${mode === "confirm" ? "selected" : ""}>${t("policy_confirm_option")}</option>
                <option value="deny" ${mode === "deny" ? "selected" : ""}>${t("policy_deny_option")}</option>
              </select>
            </div>
            ${schemaHtml}
          </div>
        </article>`;
    })
    .join("");

  toolsContainer.querySelectorAll(".tool-summary").forEach((summary) => {
    summary.addEventListener("click", () => {
      const item = summary.closest(".tool-item");
      const isOpen = item?.classList.toggle("open") || false;
      summary.setAttribute("aria-expanded", String(isOpen));
    });
  });
  toolsContainer.querySelectorAll(".policy-select").forEach((select) => {
    select.addEventListener("change", () => {
      select.disabled = true;
      chrome.runtime.sendMessage(
        {
          type: "policy.set",
          origin: select.getAttribute("data-origin"),
          originalName: select.getAttribute("data-tool"),
          mode: select.value,
        },
        (result) => {
          select.disabled = false;
          if (chrome.runtime.lastError || !result?.ok) {
            const errorEl = document.getElementById("pick-error");
            if (errorEl) {
              errorEl.hidden = false;
              errorEl.textContent =
                result?.error || chrome.runtime.lastError?.message || "Policy update failed";
            }
            fetchStatus();
          }
        },
      );
    });
  });
}

function renderConfirmations(confirmations) {
  const panel = document.getElementById("confirmations-panel");
  const container = document.getElementById("confirmations-container");
  const list = Array.isArray(confirmations) ? confirmations : [];
  panel.hidden = list.length === 0;
  if (list.length === 0) {
    container.innerHTML = "";
    return;
  }
  container.innerHTML = list
    .map(
      (item) => `<div class="confirmation-card">
        <div class="confirmation-tool">${escapeHtml(item.originalName || "tool")}</div>
        <div class="confirmation-meta">${escapeHtml(item.origin || "")}${item.clientName ? ` · ${escapeHtml(item.clientName)}` : ""}</div>
        <div class="confirmation-actions">
          <button type="button" class="confirm-allow" data-request-id="${escapeHtml(item.requestId)}">${t("confirmation_allow")}</button>
          <button type="button" class="confirm-deny" data-request-id="${escapeHtml(item.requestId)}">${t("confirmation_deny")}</button>
        </div>
      </div>`,
    )
    .join("");
  container.querySelectorAll(".confirmation-actions button").forEach((button) => {
    button.addEventListener("click", () => {
      button
        .closest(".confirmation-actions")
        ?.querySelectorAll("button")
        .forEach((item) => (item.disabled = true));
      chrome.runtime.sendMessage(
        {
          type: "confirmation.respond",
          requestId: button.getAttribute("data-request-id"),
          approved: button.classList.contains("confirm-allow"),
        },
        () => fetchStatus(),
      );
    });
  });
}

function renderInvocations(invocations) {
  const container = document.getElementById("invocations-container");
  const countEl = document.getElementById("inv-count");
  const tabCountEl = document.getElementById("activity-tab-count");

  const list = Array.isArray(invocations) ? invocations : [];
  countEl.textContent = String(list.length);
  tabCountEl.textContent = String(list.length);

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
      const errorCode = inv.errorCode ? escapeHtml(inv.errorCode) : "";
      const resultPreview = inv.resultPreview ? escapeHtml(inv.resultPreview) : "";

      let bodyText = "";
      if (isErr) {
        bodyText = `${t("error_prefix")}${errorCode ? `[${errorCode}] ` : ""}${errorMsg || "failed"}`;
      } else if (resultPreview) {
        bodyText = `Result: ${resultPreview}`;
      } else if (inv.args && typeof inv.args === "object") {
        bodyText = `Args: ${escapeHtml(JSON.stringify(inv.args))}`;
      }

      return `
        <div class="inv-item ${isErr ? "error" : ""}">
          <span class="inv-status">${isErr ? "×" : "✓"}</span>
          <div class="inv-copy">
            <div class="inv-name">${name}</div>
            <div class="inv-body">${bodyText}</div>
          </div>
          <span class="inv-meta">${timeStr}${durationStr ? ` · ${durationStr}` : ""}</span>
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
    container.innerHTML = `<div class="empty-state compact">${t("no_other_tabs")}</div>`;
    return;
  }

  container.innerHTML = others
    .map((tab) => {
      const rawTitle = tab.title || tab.origin || "Tab";
      const title = escapeHtml(rawTitle);
      const origin = escapeHtml(tab.origin || "");
      const count = Array.isArray(tab.tools) ? tab.tools.length : tab.toolCount || 0;

      return `
        <div class="tab-item">
          <div class="tab-icon">${escapeHtml(rawTitle.slice(0, 1).toUpperCase())}</div>
          <div class="tab-item-info">
            <div class="tab-item-title">${title}</div>
            <div class="tab-item-origin">${origin} · ${count} ${t("tools_suffix")}</div>
          </div>
          <button type="button" class="switch-tab-btn" data-tab-id="${tab.tabId}" title="${t("switch_tab")}" aria-label="${t("switch_tab")}">›</button>
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
    renderConfirmations([]);
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
  renderConfirmations(status.confirmations);
  renderOtherTabs(tabsList, activeTab ? activeTab.tabId : activeId);
}

function selectView(view) {
  const showTools = view !== "activity";
  document.getElementById("tools-view").hidden = !showTools;
  document.getElementById("activity-view").hidden = showTools;
  document.querySelectorAll(".view-tab").forEach((tab) => {
    const isActive = tab.getAttribute("data-view") === (showTools ? "tools" : "activity");
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
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
  } else if (message?.type === "policy.error") {
    const errorEl = document.getElementById("pick-error");
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = message.message || "Policy update failed";
    }
  }
});

// Action: Language toggle button
document.getElementById("lang-toggle-btn")?.addEventListener("click", () => {
  currentLang = currentLang === "zh" ? "en" : "zh";
  localStorage.setItem("mcp2webmcp_lang", currentLang);
  applyStaticI18n();
  renderAll(lastStatus);
});

document.querySelectorAll(".view-tab").forEach((tab) => {
  tab.addEventListener("click", () => selectView(tab.getAttribute("data-view")));
});

document.getElementById("other-tabs-toggle")?.addEventListener("click", (event) => {
  const button = event.currentTarget;
  const container = document.getElementById("other-tabs-container");
  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  container.hidden = expanded;
});

document.getElementById("auth-settings-toggle")?.addEventListener("click", () => {
  const settings = document.getElementById("auth-settings");
  settings.hidden = !settings.hidden;
  if (!settings.hidden) document.getElementById("auth-token-input")?.focus();
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

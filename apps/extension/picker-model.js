/**
 * Shared picker helpers (MAIN + isolated). Not a third product layer:
 * output is a normal registerTool def. Isolate overlay lives in content-isolated.js.
 */
(function mcp2webmcpPickerModel(globalRef) {
  const DESTRUCTIVE = /delete|remove|destroy|pay|purchase|submit|logout|unsubscribe|drop/i;

  function textOf(value) {
    return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  }

  function cssEscape(ident) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(ident);
    return String(ident).replace(/[^\w-]/g, "\\$&");
  }

  function isBindable(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName.toLowerCase();
    if (["button", "input", "textarea", "select", "summary"].includes(tag)) return true;
    if (tag === "a") return true;
    if (el.isContentEditable) return true;
    const role = (el.getAttribute("role") || "").toLowerCase();
    return ["button", "link", "textbox", "checkbox", "switch", "menuitem", "tab", "combobox"].includes(role);
  }

  function closestBindable(start) {
    let node = start;
    if (node && node.nodeType === 3) node = node.parentElement;
    while (node && node.nodeType === 1) {
      if (node.id === "mcp2webmcp-picker-host") return null;
      if (isBindable(node)) return node;
      node = node.parentElement;
    }
    return null;
  }

  function classify(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === "select" || (el.getAttribute("role") || "").toLowerCase() === "combobox") return "select";
    if (tag === "textarea" || el.isContentEditable) return "fill";
    if (tag === "input") {
      const type = (el.type || el.getAttribute("type") || "text").toLowerCase();
      if (["button", "submit", "reset", "image"].includes(type)) return "click";
      if (["checkbox", "radio"].includes(type)) return "toggle";
      return "fill";
    }
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "textbox") return "fill";
    if (role === "checkbox" || role === "switch") return "toggle";
    return "click";
  }

  function labelFor(el) {
    const aria = textOf(el.getAttribute("aria-label"));
    if (aria) return aria;
    const title = textOf(el.getAttribute("title"));
    if (title) return title;
    const placeholder = textOf(el.getAttribute("placeholder"));
    if (placeholder) return placeholder;
    const inner = textOf(el.innerText || el.textContent).slice(0, 48);
    if (inner) return inner;
    const name = textOf(el.getAttribute("name"));
    if (name) return name;
    const id = textOf(el.id);
    if (id) return id;
    return el.tagName.toLowerCase();
  }

  function slug(value) {
    const s = textOf(value)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 40);
    return s || "element";
  }

  function uniqueToolName(base, taken) {
    const root = slug(base);
    if (!taken.has(root)) return root;
    let i = 2;
    while (taken.has(`${root}_${i}`)) i += 1;
    return `${root}_${i}`;
  }

  function inputSchemaFor(kind) {
    if (kind === "fill" || kind === "select") {
      return {
        type: "object",
        properties: { value: { type: "string", description: "Value to apply" } },
        required: ["value"],
      };
    }
    if (kind === "toggle") {
      return {
        type: "object",
        properties: { checked: { type: "boolean", description: "Checked state; omit to toggle" } },
      };
    }
    return { type: "object", properties: {} };
  }

  function annotationsFor(kind, label) {
    if (kind === "click" && DESTRUCTIVE.test(label)) {
      return { destructiveHint: true, openWorldHint: true };
    }
    if (kind === "click") return { openWorldHint: true };
    return { openWorldHint: true };
  }

  function proposeTool(el) {
    const kind = classify(el);
    const label = labelFor(el);
    const name = `${kind}_${slug(label)}`;
    const action =
      kind === "fill" ? "Fill" : kind === "select" ? "Choose" : kind === "toggle" ? "Toggle" : "Click";
    return {
      name,
      description: `${action} page control “${label}” (${el.tagName.toLowerCase()})`,
      bindKind: kind,
      inputSchema: inputSchemaFor(kind),
      annotations: annotationsFor(kind, label),
      label,
    };
  }

  function uniqueAmong(root, selector) {
    try {
      return root.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  }

  function buildLocator(el, root) {
    const doc = root || el.ownerDocument || globalRef.document;
    if (!doc) return { css: el.tagName.toLowerCase() };
    if (el.id && uniqueAmong(doc, `#${cssEscape(el.id)}`)) {
      return { css: `#${cssEscape(el.id)}` };
    }
    const testId = el.getAttribute("data-testid");
    if (testId && uniqueAmong(doc, `[data-testid="${cssEscape(testId)}"]`)) {
      return { css: `[data-testid="${cssEscape(testId)}"]` };
    }
    const name = el.getAttribute("name");
    if (name) {
      const sel = `${el.tagName.toLowerCase()}[name="${cssEscape(name)}"]`;
      if (uniqueAmong(doc, sel)) return { css: sel };
    }
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== doc.documentElement) {
      if (node.id && uniqueAmong(doc, `#${cssEscape(node.id)}`)) {
        parts.unshift(`#${cssEscape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const siblings = [...parent.children].filter((child) => child.tagName === node.tagName);
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return { css: parts.join(" > ") };
  }

  function resolveLocator(locator, root) {
    const doc = root || globalRef.document;
    if (!doc || !locator || typeof locator.css !== "string") return null;
    try {
      return doc.querySelector(locator.css);
    } catch {
      return null;
    }
  }

  function setValue(el, value) {
    if (el.isContentEditable) {
      el.focus();
      el.textContent = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const proto =
      el.tagName.toLowerCase() === "textarea" ? globalRef.HTMLTextAreaElement : globalRef.HTMLInputElement;
    const desc = proto && Object.getOwnPropertyDescriptor(proto.prototype, "value");
    if (desc && typeof desc.set === "function") desc.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function executeBinding(spec, args) {
    const el = resolveLocator(spec.locator);
    if (!el) {
      throw new Error(`element not found: ${spec.locator?.css ?? "?"}`);
    }
    const kind = spec.bindKind;
    if (kind === "click") {
      el.click();
      return { content: [{ type: "text", text: `clicked ${spec.label}` }] };
    }
    if (kind === "fill" || kind === "select") {
      const value = args && typeof args.value === "string" ? args.value : "";
      if (kind === "select") {
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        setValue(el, value);
      }
      return { content: [{ type: "text", text: `set ${spec.label} to ${JSON.stringify(value)}` }] };
    }
    if (kind === "toggle") {
      const next =
        args && typeof args.checked === "boolean" ? args.checked : !(el.checked === true);
      el.checked = next;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { content: [{ type: "text", text: `${spec.label} checked=${next}` }] };
    }
    throw new Error(`unsupported bind kind: ${kind}`);
  }

  const api = {
    isBindable,
    closestBindable,
    classify,
    labelFor,
    slug,
    uniqueToolName,
    proposeTool,
    buildLocator,
    resolveLocator,
    executeBinding,
  };
  globalRef.mcp2webmcpPicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this);

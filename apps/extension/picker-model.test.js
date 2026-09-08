import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), "picker-model.js"),
  "utf8",
);

function loadPicker() {
  const sandbox = {
    console,
    Object,
    Map,
    Symbol,
    TypeError,
    Error,
    JSON,
    CSS: { escape: (value) => String(value) },
  };
  vm.runInNewContext(source, sandbox);
  return sandbox.mcp2webmcpPicker;
}

function fakeEl(tag, attrs = {}) {
  return {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    type: attrs.type,
    id: attrs.id || "",
    isContentEditable: Boolean(attrs.contentEditable),
    innerText: attrs.innerText || "",
    textContent: attrs.innerText || "",
    getAttribute(name) {
      if (name === "type") return attrs.type ?? null;
      return attrs[name] ?? null;
    },
  };
}

describe("picker-model", () => {
  it("classifies buttons and inputs", () => {
    const picker = loadPicker();
    expect(picker.classify(fakeEl("button", { innerText: "Save" }))).toBe("click");
    expect(picker.classify(fakeEl("input", { type: "text", placeholder: "Search" }))).toBe("fill");
    expect(picker.classify(fakeEl("input", { type: "checkbox" }))).toBe("toggle");
    expect(picker.classify(fakeEl("select"))).toBe("select");
    expect(picker.classify(fakeEl("input", { type: "submit" }))).toBe("click");
  });

  it("proposes click_save and fill_search names", () => {
    const picker = loadPicker();
    expect(picker.proposeTool(fakeEl("button", { innerText: "Save", id: "save-btn" })).name).toBe(
      "click_save",
    );
    expect(picker.proposeTool(fakeEl("input", { type: "text", placeholder: "Search" })).name).toBe(
      "fill_search",
    );
  });

  it("marks destructive clicks", () => {
    const picker = loadPicker();
    const tool = picker.proposeTool(fakeEl("button", { innerText: "Delete account" }));
    expect(tool.annotations.destructiveHint).toBe(true);
  });

  it("uniques duplicate names", () => {
    const picker = loadPicker();
    const taken = new Set(["click_save"]);
    expect(picker.uniqueToolName("click_save", taken)).toBe("click_save_2");
  });

  it("walks up to a bindable ancestor", () => {
    const picker = loadPicker();
    const button = fakeEl("button", { innerText: "Go" });
    const span = {
      nodeType: 1,
      tagName: "SPAN",
      parentElement: button,
      id: "",
      getAttribute: () => null,
    };
    button.parentElement = null;
    expect(picker.closestBindable(span)).toBe(button);
  });
});

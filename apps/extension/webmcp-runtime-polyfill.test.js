import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const polyfillPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "webmcp-runtime-polyfill.js");
const POLYFILL_BRAND = Symbol.for("mcp2webmcp.webmcp-runtime-polyfill");
const source = fs.readFileSync(polyfillPath, "utf8");

function runPolyfill(overrides = {}) {
  const documentRef = overrides.document ?? {};
  const navigatorRef = overrides.navigator ?? {};
  const sandbox = {
    console,
    Object,
    Map,
    Symbol,
    TypeError,
    Error,
    Promise,
    document: documentRef,
    navigator: navigatorRef,
    isSecureContext: overrides.isSecureContext ?? true,
  };
  vm.runInNewContext(source, sandbox);
  return { sandbox, documentRef, navigatorRef };
}

describe("webmcp-runtime-polyfill", () => {
  it("installs one host on document and navigator when missing", async () => {
    const { documentRef, navigatorRef } = runPolyfill();
    expect(documentRef.modelContext).toBe(navigatorRef.modelContext);
    expect(typeof documentRef.modelContext.registerTool).toBe("function");
    expect(documentRef.modelContext[POLYFILL_BRAND]).toBe(true);
    await documentRef.modelContext.registerTool({
      name: "echo",
      description: "Echo",
      execute: async () => "ok",
    });
    expect(documentRef.modelContext.getTools().map((tool) => tool.name)).toEqual(["echo"]);
  });

  it("does not install over an existing registerTool host", () => {
    const existing = { registerTool() {} };
    const { documentRef } = runPolyfill({ document: { modelContext: existing } });
    expect(documentRef.modelContext).toBe(existing);
    expect(documentRef.modelContext[POLYFILL_BRAND]).toBeUndefined();
  });

  it("does not install outside a secure context", () => {
    const { documentRef } = runPolyfill({ isSecureContext: false });
    expect(documentRef.modelContext).toBeUndefined();
  });

  it("rejects duplicate names and drops a tool on abort", async () => {
    const host = runPolyfill().sandbox.createWebMcpRuntimePolyfill();
    const def = {
      name: "echo",
      description: "Echo",
      execute: async () => "ok",
    };
    await host.registerTool(def);
    await expect(host.registerTool(def)).rejects.toThrow(/already registered/);
    const controller = new AbortController();
    await host.registerTool(
      { name: "temp", description: "Temp", execute: async () => "x" },
      { signal: controller.signal },
    );
    expect(host.getTools().map((tool) => tool.name).sort()).toEqual(["echo", "temp"]);
    controller.abort();
    expect(host.getTools().map((tool) => tool.name)).toEqual(["echo"]);
  });
});

import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { discoveredTool, FakeBrowserAdapter } from "@mcp2webmcp/browser-adapter";
import { RuntimeError } from "@mcp2webmcp/protocol";
import { createRuntime } from "../runtime.js";
import { testConfig, testSource } from "../../../../tests/helpers.js";

async function setup(toolName = "echo") {
  const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-"));
  const auditPath = join(dir, "audit.jsonl");
  const rt = createRuntime(testConfig({ audit: { path: auditPath } }));
  const adapter = new FakeBrowserAdapter("fake-1");
  await rt.attach(adapter);
  adapter.connectSource(testSource({ adapterId: "fake-1" }));
  adapter.registerTool("tab-18", discoveredTool(toolName));
  const tool = rt.tools.list()[0];
  if (!tool) throw new Error("tool missing");
  return { rt, adapter, tool, auditPath };
}

function invokeOptions(ms = 5_000) {
  return { signal: new AbortController().signal, deadline: Date.now() + ms };
}

describe("ToolRouter", () => {
  it("allows an exact rule and invokes the adapter", async () => {
    const { rt, tool, auditPath } = await setup("echo");
    const result = await rt.router.invoke(
      {
        requestId: "r1",
        target: { mcpName: tool.identity.mcpName },
        input: { message: "hi" },
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(result.status).toBe("success");
    const lines = readFileSync(auditPath, "utf8").trim().split("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(JSON.parse(lines[0] ?? "{}").decision).toBe("allow");
  });

  it("denies by default without executing", async () => {
    const { rt, adapter } = await setup("echo");
    adapter.registerTool("tab-18", discoveredTool("other"));
    const other = rt.tools.list().find((item) => item.identity.originalName === "other");
    let executed = false;
    adapter.setHandler("tab-18", "other", async () => {
      executed = true;
      return { content: [] };
    });
    const result = await rt.router.invoke(
      {
        requestId: "r2",
        target: { runtimeId: other?.identity.runtimeId ?? "" },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(result).toMatchObject({ status: "error", error: { code: "POLICY_DENIED" } });
    expect(executed).toBe(false);
  });

  it("fail-closes confirm when no approval channel exists", async () => {
    const { rt, adapter } = await setup("echo");
    adapter.registerTool("tab-18", {
      ...discoveredTool("delete_me"),
      annotations: { destructiveHint: true },
    });
    const del = rt.tools.list().find((item) => item.identity.originalName === "delete_me");
    const result = await rt.router.invoke(
      {
        requestId: "r3",
        target: { runtimeId: del?.identity.runtimeId ?? "" },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(result).toMatchObject({
      status: "error",
      error: { code: "CONFIRMATION_UNAVAILABLE" },
      outcome: "not_executed",
    });
  });

  it("does not dispatch when generation changes after policy", async () => {
    const { rt, tool } = await setup("echo");
    const source = rt.sources.get("fake-1", "tab-18");
    if (!source) throw new Error("missing source");
    const result = await rt.router.invoke(
      {
        requestId: "r4",
        target: { runtimeId: tool.identity.runtimeId },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    // Sanity: first call works so the tool exists; now bump generation and retry.
    expect(result.status).toBe("success");
    rt.sources.upsert({ ...source, generation: source.generation + 1, updatedAt: Date.now() });
    const stale = await rt.router.invoke(
      {
        requestId: "r4b",
        target: { runtimeId: tool.identity.runtimeId },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(stale).toMatchObject({
      status: "error",
      error: { code: "TOOL_UNAVAILABLE" },
    });
  });

  it("returns cancelled when the client aborts before dispatch", async () => {
    const { rt, tool } = await setup("echo");
    const controller = new AbortController();
    controller.abort();
    const result = await rt.router.invoke(
      {
        requestId: "r5",
        target: { runtimeId: tool.identity.runtimeId },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      { signal: controller.signal, deadline: Date.now() + 5_000 },
    );
    expect(result).toMatchObject({
      status: "error",
      error: { code: "CANCELLED" },
      outcome: "not_executed",
    });
  });

  it("returns OUTCOME_UNKNOWN on timeout when a side effect may have started", async () => {
    const { rt, adapter, tool } = await setup("echo");
    adapter.setHandler("tab-18", "echo", async (_input, { signal }) => {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 1_000);
        signal.addEventListener("abort", () => {
          clearTimeout(timer);
          reject(new Error("aborted"));
        });
      });
      return { content: [] };
    });
    const result = await rt.router.invoke(
      {
        requestId: "r6",
        target: { runtimeId: tool.identity.runtimeId },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      { signal: new AbortController().signal, deadline: Date.now() + 80 },
    );
    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.error.code).toBe("OUTCOME_UNKNOWN");
      expect(result.outcome).toBe("unknown");
    }
  });

  it("enforces the per-source queue limit", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-"));
    const rt = createRuntime(
      testConfig({
        audit: { path: join(dir, "audit.jsonl") },
        limits: { maxQueuePerSource: 1 },
      }),
    );
    const adapter = new FakeBrowserAdapter("fake-1");
    await rt.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    const tool = rt.tools.list()[0];
    adapter.setHandler("tab-18", "echo", async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { content: [] };
    });
    const first = rt.router.invoke(
      {
        requestId: "q1",
        target: { runtimeId: tool?.identity.runtimeId ?? "" },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    const second = rt.router.invoke(
      {
        requestId: "q2",
        target: { runtimeId: tool?.identity.runtimeId ?? "" },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    const results = await Promise.all([first, second]);
    expect(results.some((item) => item.status === "error" && item.error.code === "RATE_LIMITED")).toBe(
      true,
    );
  });

  it("rejects oversized input", async () => {
    const { rt, tool } = await setup("echo");
    const result = await rt.router.invoke(
      {
        requestId: "r7",
        target: { runtimeId: tool.identity.runtimeId },
        input: { blob: "x".repeat(2_000_000) },
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(result).toMatchObject({ status: "error", error: { code: "INVALID_INPUT" } });
  });

  it("rejects an oversized input schema at invoke time", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-"));
    const rt = createRuntime(
      testConfig({
        audit: { path: join(dir, "audit.jsonl") },
        limits: { maxSchemaBytes: 64 },
      }),
    );
    const adapter = new FakeBrowserAdapter("fake-1");
    await rt.attach(adapter);
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool(
      "tab-18",
      discoveredTool("echo", {
        type: "object",
        properties: { blob: { type: "string", description: "n".repeat(200) } },
      }),
    );
    const tool = rt.tools.list()[0];
    const result = await rt.router.invoke(
      {
        requestId: "schema-1",
        target: { runtimeId: tool?.identity.runtimeId ?? "" },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(result).toMatchObject({ status: "error", error: { code: "SCHEMA_TOO_LARGE" } });
  });

  it("rejects oversized adapter output", async () => {
    const { rt, adapter, tool } = await setup("echo");
    adapter.setHandler("tab-18", "echo", async () => ({
      content: [{ type: "text", text: "y".repeat(5_000_000) }],
    }));
    const result = await rt.router.invoke(
      {
        requestId: "out-1",
        target: { runtimeId: tool.identity.runtimeId },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(result).toMatchObject({ status: "error", error: { code: "RESULT_TOO_LARGE" } });
  });

  it("does not execute when the pre-dispatch audit write fails", async () => {
    const { rt, adapter, tool } = await setup("echo");
    let executed = false;
    adapter.setHandler("tab-18", "echo", async () => {
      executed = true;
      return { content: [] };
    });
    rt.audit.append = async () => {
      throw new RuntimeError("AUDIT_FAILED", "disk full");
    };
    const result = await rt.router.invoke(
      {
        requestId: "r8",
        target: { runtimeId: tool.identity.runtimeId },
        input: {},
        client: { processInstanceId: "proc-1" },
      },
      invokeOptions(),
    );
    expect(executed).toBe(false);
    expect(result).toMatchObject({ status: "error", error: { code: "AUDIT_FAILED" } });
  });
});

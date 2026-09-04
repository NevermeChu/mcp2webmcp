import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RuntimeLogger } from "./runtime-logger.js";

describe("RuntimeLogger", () => {
  it("writes JSONL and returns recent records without human setup", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-log-"));
    const path = join(dir, "runtime.jsonl");
    const log = new RuntimeLogger({ path, logLevel: "info", stderr: false });
    log.info("gateway", "source.added", { sourceId: "tab:1", origin: "http://127.0.0.1:18081" });
    log.warn("extension", "tools.replace", { count: 0, runtimeError: "no-webmcp-runtime" });
    const lines = readFileSync(path, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    const recent = log.recent(10);
    expect(recent.map((row) => row.event)).toEqual(["source.added", "tools.replace"]);
    expect(recent[1]?.hop).toBe("extension");
  });

  it("keeps debug off the file while info stays on disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-log-"));
    const path = join(dir, "runtime.jsonl");
    const log = new RuntimeLogger({ path, logLevel: "debug", stderr: false });
    log.debug("mcp", "projector.skip", { projectedCount: 1 });
    log.info("mcp", "projector.sync", { added: ["echo"] });
    const text = readFileSync(path, "utf8");
    expect(text).not.toMatch(/projector.skip/);
    expect(text).toMatch(/projector.sync/);
  });
});

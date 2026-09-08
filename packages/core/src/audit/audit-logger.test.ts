import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AuditLogger } from "./audit-logger.js";

describe("AuditLogger", () => {
  it("continues rotating after a previous backup exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-audit-"));
    const path = join(dir, "audit.jsonl");
    const logger = new AuditLogger({ enabled: true, path, maxBytes: 1 });
    const record = {
      requestId: "r1",
      timestamp: Date.now(),
      processInstanceId: "p1",
      target: "echo",
      decision: "allow" as const,
    };

    await logger.append(record);
    await logger.append({ ...record, requestId: "r2" });
    await logger.append({ ...record, requestId: "r3" });

    expect(existsSync(`${path}.1`)).toBe(true);
    expect(readFileSync(path, "utf8")).toContain('"requestId":"r3"');
  });
});

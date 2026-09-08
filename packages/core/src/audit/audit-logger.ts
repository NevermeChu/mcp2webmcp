import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { chmod } from "node:fs/promises";
import { dirname } from "node:path";
import { RuntimeError, type AuditConfig, type AuditRecord } from "@mcp2webmcp/protocol";

export class AuditLogger {
  constructor(private readonly config: AuditConfig) {}

  async append(record: AuditRecord): Promise<void> {
    if (!this.config.enabled) return;
    const line = `${JSON.stringify(record)}\n`;
    try {
      mkdirSync(dirname(this.config.path), { recursive: true });
      await this.rotateIfNeeded(line.length);
      writeFileSync(this.config.path, line, { encoding: "utf8", flag: "a", mode: 0o600 });
      await chmod(this.config.path, 0o600).catch(() => undefined);
    } catch (error) {
      throw new RuntimeError(
        "AUDIT_FAILED",
        `audit write failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async rotateIfNeeded(nextBytes: number): Promise<void> {
    const { statSync } = await import("node:fs");
    let size = 0;
    try {
      size = statSync(this.config.path).size;
    } catch {
      return;
    }
    if (size + nextBytes <= this.config.maxBytes) return;
    const backupPath = `${this.config.path}.1`;
    rmSync(backupPath, { force: true });
    renameSync(this.config.path, backupPath);
  }
}

import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ToolPolicyMode, ToolPolicyOverride } from "@mcp2webmcp/protocol";

interface OverrideFile {
  version: 1;
  overrides: ToolPolicyOverride[];
}

export interface PolicyOverrideStore {
  get(origin: string, originalName: string): ToolPolicyOverride | undefined;
  set(origin: string, originalName: string, mode: ToolPolicyMode): ToolPolicyOverride;
  list(): ToolPolicyOverride[];
}

export class MemoryPolicyOverrideStore implements PolicyOverrideStore {
  protected data: OverrideFile = { version: 1, overrides: [] };

  get(origin: string, originalName: string): ToolPolicyOverride | undefined {
    return this.data.overrides.find(
      (entry) => entry.origin === origin && entry.originalName === originalName,
    );
  }

  set(origin: string, originalName: string, mode: ToolPolicyMode): ToolPolicyOverride {
    const entry = {
      origin,
      originalName,
      mode,
      updatedAt: Date.now(),
    } satisfies ToolPolicyOverride;
    this.data.overrides = this.data.overrides.filter(
      (item) => item.origin !== origin || item.originalName !== originalName,
    );
    this.data.overrides.push(entry);
    this.persist();
    return entry;
  }

  list(): ToolPolicyOverride[] {
    return [...this.data.overrides];
  }

  protected persist(): void {}
}

export class FilePolicyOverrideStore extends MemoryPolicyOverrideStore {
  constructor(private readonly filePath: string) {
    super();
  }

  override get(origin: string, originalName: string): ToolPolicyOverride | undefined {
    this.refresh();
    return super.get(origin, originalName);
  }

  override list(): ToolPolicyOverride[] {
    this.refresh();
    return super.list();
  }

  override set(origin: string, originalName: string, mode: ToolPolicyMode): ToolPolicyOverride {
    this.refresh();
    return super.set(origin, originalName, mode);
  }

  private refresh(): void {
    try {
      this.data = this.readDiskFile();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        this.data = { version: 1, overrides: [] };
        return;
      }
      throw new Error(
        `policy override file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private readDiskFile(): OverrideFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as OverrideFile;
      if (parsed?.version !== 1 || !Array.isArray(parsed.overrides)) {
        throw new Error("invalid policy override file structure");
      }
      if (!parsed.overrides.every(isOverride)) {
        throw new Error("invalid policy override entry");
      }
      return { version: 1, overrides: parsed.overrides };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, overrides: [] };
      }
      throw error;
    }
  }

  protected override persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    acquireLock(lockPath);
    try {
      this.data = mergeFiles(this.readDiskFile(), this.data);
      const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      try {
        writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
        renameSync(tempPath, this.filePath);
      } finally {
        rmSync(tempPath, { force: true });
      }
    } finally {
      rmSync(lockPath, { recursive: true, force: true });
    }
  }
}

const LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

function acquireLock(lockPath: string): void {
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > 30_000) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started >= 5_000) throw new Error("timed out acquiring policy lock");
      Atomics.wait(LOCK_WAIT, 0, 0, 10);
    }
  }
}

function mergeFiles(disk: OverrideFile, local: OverrideFile): OverrideFile {
  const entries = new Map<string, ToolPolicyOverride>();
  for (const entry of [...disk.overrides, ...local.overrides]) {
    const key = `${entry.origin}\u0000${entry.originalName}`;
    const previous = entries.get(key);
    if (
      !previous ||
      entry.updatedAt > previous.updatedAt ||
      (entry.updatedAt === previous.updatedAt && modeRank(entry.mode) > modeRank(previous.mode))
    ) {
      entries.set(key, entry);
    }
  }
  return { version: 1, overrides: [...entries.values()] };
}

function modeRank(mode: ToolPolicyMode): number {
  return mode === "deny" ? 2 : mode === "confirm" ? 1 : 0;
}

function isOverride(value: unknown): value is ToolPolicyOverride {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Partial<ToolPolicyOverride>;
  return (
    typeof item.origin === "string" &&
    typeof item.originalName === "string" &&
    (item.mode === "allow" || item.mode === "confirm" || item.mode === "deny") &&
    typeof item.updatedAt === "number"
  );
}

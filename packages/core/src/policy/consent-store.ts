import { mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ConsentOriginRecord, ConsentToolRecord } from "@mcp2webmcp/protocol";

interface ConsentToolState {
  enabled: boolean;
  admittedAt: number;
  revokedAt?: number;
}

interface ConsentOriginState {
  enabled: boolean;
  admittedAt: number;
  revokedAt?: number;
  tools: Record<string, ConsentToolState>;
}

interface ConsentFile {
  version: 1;
  origins: Record<string, ConsentOriginState>;
}

export interface ConsentStore {
  readonly enabled: boolean;
  readonly autoAdmit: boolean;
  allows(origin: string, originalName: string): boolean;
  admit(origin: string, originalName: string): boolean;
  revoke(origin: string, originalName?: string): boolean;
  restore(origin: string, originalName?: string): boolean;
  list(): ConsentOriginRecord[];
}

export class MemoryConsentStore implements ConsentStore {
  readonly enabled: boolean;
  readonly autoAdmit: boolean;
  protected data: ConsentFile = { version: 1, origins: {} };

  constructor(options?: { enabled?: boolean; autoAdmit?: boolean }) {
    this.enabled = options?.enabled ?? true;
    this.autoAdmit = options?.autoAdmit ?? true;
  }

  allows(origin: string, originalName: string): boolean {
    if (!this.enabled) return false;
    const entry = this.data.origins[origin];
    if (!entry?.enabled) return false;
    const tool = entry.tools[originalName];
    return Boolean(tool?.enabled);
  }

  admit(origin: string, originalName: string): boolean {
    if (!this.enabled || !this.autoAdmit) return false;
    const now = Date.now();
    const existing = this.data.origins[origin];
    if (existing && !existing.enabled) return false;
    if (existing?.tools[originalName]) return false;
    const originState: ConsentOriginState = existing ?? {
      enabled: true,
      admittedAt: now,
      tools: {},
    };
    originState.tools[originalName] = { enabled: true, admittedAt: now };
    this.data.origins[origin] = originState;
    this.persist();
    return true;
  }

  revoke(origin: string, originalName?: string): boolean {
    const entry = this.data.origins[origin];
    if (!entry) return false;
    const now = Date.now();
    if (!originalName) {
      if (!entry.enabled) return false;
      entry.enabled = false;
      entry.revokedAt = now;
      this.persist();
      return true;
    }
    const tool = entry.tools[originalName] ?? { enabled: true, admittedAt: now };
    if (!tool.enabled && entry.tools[originalName]) return false;
    tool.enabled = false;
    tool.revokedAt = now;
    entry.tools[originalName] = tool;
    this.persist();
    return true;
  }

  restore(origin: string, originalName?: string): boolean {
    const entry = this.data.origins[origin];
    if (!entry) return false;
    if (!originalName) {
      if (entry.enabled) return false;
      entry.enabled = true;
      entry.admittedAt = Date.now();
      entry.revokedAt = undefined;
      this.persist();
      return true;
    }
    const tool = entry.tools[originalName];
    if (!tool) return false;
    if (tool.enabled) return false;
    tool.enabled = true;
    // Bump admittedAt so the concurrent-writer merge (persist) sees this
    // restore as newer than any revoke tombstone on disk.
    tool.admittedAt = Date.now();
    tool.revokedAt = undefined;
    if (!entry.enabled) {
      entry.enabled = true;
      entry.admittedAt = Date.now();
      entry.revokedAt = undefined;
    }
    this.persist();
    return true;
  }

  list(): ConsentOriginRecord[] {
    return Object.entries(this.data.origins).map(([origin, entry]) => ({
      origin,
      enabled: entry.enabled,
      admittedAt: entry.admittedAt,
      revokedAt: entry.revokedAt,
      tools: Object.entries(entry.tools).map(([originalName, tool]) =>
        toToolRecord(originalName, tool),
      ),
    }));
  }

  protected persist(): void {
    // Memory store is ephemeral.
  }
}

export class FileConsentStore extends MemoryConsentStore {
  private diskReadable = true;

  constructor(
    private readonly filePath: string,
    options?: { enabled?: boolean; autoAdmit?: boolean },
  ) {
    super(options);
  }

  override allows(origin: string, originalName: string): boolean {
    this.refreshFromDisk();
    if (!this.diskReadable) return false;
    return super.allows(origin, originalName);
  }

  override list(): ConsentOriginRecord[] {
    this.refreshFromDisk();
    if (!this.diskReadable) return [];
    return super.list();
  }

  override admit(origin: string, originalName: string): boolean {
    this.refreshFromDisk();
    if (!this.diskReadable) return false;
    return super.admit(origin, originalName);
  }

  override revoke(origin: string, originalName?: string): boolean {
    this.refreshFromDisk();
    if (!this.diskReadable) return false;
    return super.revoke(origin, originalName);
  }

  override restore(origin: string, originalName?: string): boolean {
    this.refreshFromDisk();
    if (!this.diskReadable)
      throw new Error(`cannot restore unreadable consent file: ${this.filePath}`);
    return super.restore(origin, originalName);
  }

  /** Other Gateway processes share this file; re-read when it changed on disk. */
  private refreshFromDisk(): void {
    // Always re-read: Windows filesystems can retain the same mtime and size for
    // two different same-length writes made close together.
    try {
      this.data = this.readDiskFile();
      this.diskReadable = true;
    } catch {
      // A corrupt/unreadable authority file must fail closed and must not be
      // silently replaced by a new auto-admission.
      this.data = { version: 1, origins: {} };
      this.diskReadable = false;
    }
  }

  private readDiskFile(): ConsentFile {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as ConsentFile;
      if (parsed?.version === 1 && parsed.origins && typeof parsed.origins === "object") {
        return { version: 1, origins: parsed.origins };
      }
      throw new Error("invalid consent file structure");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, origins: {} };
      }
      throw new Error(
        `consent file is unreadable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  protected override persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.lock`;
    acquireFileLock(lockPath);
    try {
      // Read and merge only while holding the cross-process lock. Atomic rename
      // alone prevents torn JSON but does not prevent a lost update.
      this.data = mergeConsentFiles(this.data, this.readDiskFile());
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

const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const LOCK_WAIT = new Int32Array(new SharedArrayBuffer(4));

function acquireFileLock(lockPath: string): void {
  const started = Date.now();
  while (true) {
    try {
      mkdirSync(lockPath);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_LOCK_MS) {
          rmSync(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error(`timed out acquiring consent lock: ${lockPath}`);
      }
      Atomics.wait(LOCK_WAIT, 0, 0, 10);
    }
  }
}

function mergeConsentFiles(local: ConsentFile, disk: ConsentFile): ConsentFile {
  const merged: ConsentFile = { version: 1, origins: { ...disk.origins } };
  for (const [origin, localEntry] of Object.entries(local.origins)) {
    const diskEntry = merged.origins[origin];
    merged.origins[origin] = diskEntry ? mergeOriginEntry(diskEntry, localEntry) : localEntry;
  }
  return merged;
}

function mergeOriginEntry(disk: ConsentOriginState, local: ConsentOriginState): ConsentOriginState {
  const tools: Record<string, ConsentToolState> = { ...disk.tools };
  for (const [name, localTool] of Object.entries(local.tools)) {
    const diskTool = tools[name];
    tools[name] = diskTool ? mergeToolEntry(diskTool, localTool) : localTool;
  }
  const enabled = pickNewerState(disk, local);
  return {
    enabled,
    admittedAt: Math.max(disk.admittedAt, local.admittedAt),
    revokedAt: enabled ? undefined : later(disk.revokedAt, local.revokedAt),
    tools,
  };
}

function mergeToolEntry(disk: ConsentToolState, local: ConsentToolState): ConsentToolState {
  const enabled = pickNewerState(disk, local);
  return {
    enabled,
    admittedAt: Math.max(disk.admittedAt, local.admittedAt),
    revokedAt: enabled ? undefined : later(disk.revokedAt, local.revokedAt),
  };
}

function pickNewerState(
  disk: { enabled: boolean; admittedAt: number; revokedAt?: number },
  local: { enabled: boolean; admittedAt: number; revokedAt?: number },
): boolean {
  const diskTs = disk.enabled ? disk.admittedAt : (disk.revokedAt ?? disk.admittedAt);
  const localTs = local.enabled ? local.admittedAt : (local.revokedAt ?? local.admittedAt);
  if (diskTs === localTs) return disk.enabled && local.enabled;
  return diskTs > localTs ? disk.enabled : local.enabled;
}

function later(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

export class DisabledConsentStore implements ConsentStore {
  readonly enabled = false;
  readonly autoAdmit = false;

  allows(): boolean {
    return false;
  }

  admit(): boolean {
    return false;
  }

  revoke(): boolean {
    return false;
  }

  restore(): boolean {
    return false;
  }

  list(): ConsentOriginRecord[] {
    return [];
  }
}

function toToolRecord(originalName: string, tool: ConsentToolState): ConsentToolRecord {
  return {
    originalName,
    enabled: tool.enabled,
    admittedAt: tool.admittedAt,
    revokedAt: tool.revokedAt,
  };
}

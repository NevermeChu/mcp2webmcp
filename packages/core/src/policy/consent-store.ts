import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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
      entry.revokedAt = undefined;
      this.persist();
      return true;
    }
    const tool = entry.tools[originalName];
    if (!tool) return false;
    if (tool.enabled) return false;
    tool.enabled = true;
    tool.revokedAt = undefined;
    if (!entry.enabled) {
      entry.enabled = true;
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
      tools: Object.entries(entry.tools).map(([originalName, tool]) => toToolRecord(originalName, tool)),
    }));
  }

  protected persist(): void {
    // Memory store is ephemeral.
  }
}

export class FileConsentStore extends MemoryConsentStore {
  constructor(
    private readonly filePath: string,
    options?: { enabled?: boolean; autoAdmit?: boolean },
  ) {
    super(options);
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as ConsentFile;
      if (parsed?.version === 1 && parsed.origins && typeof parsed.origins === "object") {
        this.data = { version: 1, origins: parsed.origins };
      }
    } catch {
      this.data = { version: 1, origins: {} };
    }
  }

  protected override persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(tempPath, `${JSON.stringify(this.data, null, 2)}\n`, "utf8");
    renameSync(tempPath, this.filePath);
  }
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

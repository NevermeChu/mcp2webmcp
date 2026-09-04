import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  LOG_LEVEL_RANK,
  type LogHop,
  type LogLevel,
  type LogRecord,
  type RuntimeLog,
} from "@mcp2webmcp/protocol";

const RING_MAX = 500;
const DEFAULT_FILE_MAX = 5_242_880;

export class RuntimeLogger implements RuntimeLog {
  readonly path: string;
  private readonly ring: LogRecord[] = [];
  private readonly fileMinLevel: LogLevel;
  private readonly stderrMinLevel: LogLevel;
  private readonly maxBytes: number;

  constructor(options: {
    path?: string;
    logLevel?: LogLevel;
    maxBytes?: number;
    /** When false, still keep the in-memory ring (tests). */
    stderr?: boolean;
  }) {
    this.path = options.path ?? "";
    this.stderrMinLevel = options.logLevel ?? "info";
    this.fileMinLevel = "info";
    this.maxBytes = options.maxBytes ?? DEFAULT_FILE_MAX;
    this.stderrEnabled = options.stderr !== false;
  }

  private readonly stderrEnabled: boolean;

  write(input: Omit<LogRecord, "ts"> & { ts?: number }): void {
    const record: LogRecord = {
      ts: input.ts ?? Date.now(),
      level: input.level,
      hop: input.hop,
      event: input.event,
      message: input.message,
      traceId: input.traceId,
      data: input.data,
    };
    this.ring.push(record);
    if (this.ring.length > RING_MAX) this.ring.shift();
    if (this.path && LOG_LEVEL_RANK[record.level] >= LOG_LEVEL_RANK[this.fileMinLevel]) {
      this.appendFile(record);
    }
    if (this.stderrEnabled && LOG_LEVEL_RANK[record.level] >= LOG_LEVEL_RANK[this.stderrMinLevel]) {
      process.stderr.write(`${formatLine(record)}\n`);
    }
  }

  info(hop: LogHop, event: string, data?: Record<string, unknown>, extra?: { message?: string; traceId?: string }): void {
    this.write({ level: "info", hop, event, data, ...extra });
  }

  warn(hop: LogHop, event: string, data?: Record<string, unknown>, extra?: { message?: string; traceId?: string }): void {
    this.write({ level: "warn", hop, event, data, ...extra });
  }

  error(hop: LogHop, event: string, data?: Record<string, unknown>, extra?: { message?: string; traceId?: string }): void {
    this.write({ level: "error", hop, event, data, ...extra });
  }

  debug(hop: LogHop, event: string, data?: Record<string, unknown>, extra?: { message?: string; traceId?: string }): void {
    this.write({ level: "debug", hop, event, data, ...extra });
  }

  recent(limit = 80): LogRecord[] {
    const cap = Math.min(Math.max(1, limit), RING_MAX);
    if (this.path) {
      const fromFile = readFileTail(this.path, cap);
      if (fromFile.length > 0) return fromFile;
    }
    return this.ring.slice(-cap);
  }

  private appendFile(record: LogRecord): void {
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const line = `${formatLine(record)}\n`;
      rotateIfNeeded(this.path, this.maxBytes, line.length);
      writeFileSync(this.path, line, { encoding: "utf8", flag: "a", mode: 0o600 });
    } catch {
      // Logging must never break stdio MCP.
    }
  }
}

function formatLine(record: LogRecord): string {
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({
      ts: record.ts,
      level: record.level,
      hop: record.hop,
      event: record.event,
      message: "log serialize failed",
    });
  }
}

function rotateIfNeeded(path: string, maxBytes: number, nextBytes: number): void {
  try {
    const size = statSync(path).size;
    if (size + nextBytes <= maxBytes) return;
    renameSync(path, `${path}.1`);
  } catch {
    // missing file is fine
  }
}

function readFileTail(path: string, limit: number): LogRecord[] {
  try {
    const text = readFileSync(path, "utf8");
    const lines = text.split("\n").filter((line) => line.trim().length > 0);
    const slice = lines.slice(-limit);
    const out: LogRecord[] = [];
    for (const line of slice) {
      try {
        out.push(JSON.parse(line) as LogRecord);
      } catch {
        // skip corrupt line
      }
    }
    return out;
  } catch {
    return [];
  }
}

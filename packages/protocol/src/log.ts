export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogHop = "page" | "extension" | "gateway" | "mcp";

export interface LogRecord {
  ts: number;
  level: LogLevel;
  hop: LogHop;
  event: string;
  message?: string;
  traceId?: string;
  data?: Record<string, unknown>;
}

export interface RuntimeLog {
  readonly path: string;
  write(record: Omit<LogRecord, "ts"> & { ts?: number }): void;
  recent(limit?: number): LogRecord[];
}

export const LOG_LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function isLogLevel(value: unknown): value is LogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

export function isLogHop(value: unknown): value is LogHop {
  return value === "page" || value === "extension" || value === "gateway" || value === "mcp";
}

/** Keep log payloads compact and free of obvious secrets. */
export function sanitizeLogData(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(out).length >= 24) break;
    if (/cookie|authorization|password|secret|token|set-cookie/i.test(key)) continue;
    if (item === null || typeof item === "number" || typeof item === "boolean") {
      out[key] = item;
      continue;
    }
    if (typeof item === "string") {
      out[key] = item.length > 400 ? `${item.slice(0, 400)}…` : item;
      continue;
    }
    if (Array.isArray(item) && item.every((entry) => typeof entry === "string")) {
      out[key] = item.slice(0, 40);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

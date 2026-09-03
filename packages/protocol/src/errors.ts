export type RuntimeErrorCode =
  | "TOOL_NOT_FOUND"
  | "TOOL_UNAVAILABLE"
  | "SOURCE_NOT_FOUND"
  | "SOURCE_DISCONNECTED"
  | "POLICY_DENIED"
  | "CONFIRMATION_REQUIRED"
  | "CONFIRMATION_UNAVAILABLE"
  | "INVALID_INPUT"
  | "CANCELLED"
  | "INVOCATION_TIMEOUT"
  | "OUTCOME_UNKNOWN"
  | "RESULT_TOO_LARGE"
  | "RATE_LIMITED"
  | "BROWSER_ERROR"
  | "WEBMCP_ERROR"
  | "INTERNAL_ERROR"
  | "AUDIT_FAILED"
  | "SCHEMA_TOO_LARGE";

export type InvokeOutcome = "not_executed" | "executed_failed" | "unknown";

export class RuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly outcome: InvokeOutcome;

  constructor(code: RuntimeErrorCode, message: string, outcome: InvokeOutcome = "not_executed") {
    super(message);
    this.name = "RuntimeError";
    this.code = code;
    this.outcome = outcome;
  }
}

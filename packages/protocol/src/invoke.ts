import type { BrowserSource } from "./source.js";
import type { RuntimeTool } from "./tool.js";
import type { InvokeOutcome, RuntimeErrorCode } from "./errors.js";

export interface RuntimeInvokeRequest {
  requestId: string;
  target: { mcpName: string } | { runtimeId: string };
  input: unknown;
  client: {
    processInstanceId: string;
    claimedName?: string;
  };
}

export interface RuntimeInvokeSuccess {
  status: "success";
  content: unknown[];
  structuredContent?: unknown;
  sourceGeneration: number;
}

export interface RuntimeInvokeError {
  status: "error";
  error: {
    code: RuntimeErrorCode;
    message: string;
  };
  outcome: InvokeOutcome;
}

export interface RuntimeInvokeConfirmationRequired {
  status: "confirmation_required";
  confirmationId: string;
  summary: string;
}

export type RuntimeInvokeResult =
  | RuntimeInvokeSuccess
  | RuntimeInvokeError
  | RuntimeInvokeConfirmationRequired;

export interface BrowserToolInvokeRequest {
  requestId: string;
  sourceId: string;
  sourceGeneration: number;
  originalName: string;
  input: unknown;
}

export interface BrowserToolInvokeResult {
  content: unknown[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface BrowserAdapterEventMeta {
  adapterId: string;
  sourceId: string;
  sourceGeneration: number;
  revision: number;
}

export type BrowserAdapterEvent = BrowserAdapterEventMeta &
  (
    | { type: "source.connected"; source: BrowserSource }
    | { type: "source.updated"; source: BrowserSource }
    | { type: "source.disconnected"; sourceId: string }
    | { type: "tool.registered"; tool: RuntimeTool }
    | { type: "tool.updated"; tool: RuntimeTool }
    | { type: "tool.unregistered"; runtimeId: string; originalName: string }
  );

export interface BrowserAdapter {
  readonly adapterId: string;
  readonly type: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  listSources(): Promise<BrowserSource[]>;
  listTools(sourceId: string): Promise<RuntimeTool[]>;
  invokeTool(
    request: BrowserToolInvokeRequest,
    options: { signal: AbortSignal; deadline: number },
  ): Promise<BrowserToolInvokeResult>;
  subscribe(handler: (event: BrowserAdapterEvent) => void): () => void;
}

export interface AdapterRegistry {
  register(adapter: BrowserAdapter): void;
  unregister(adapterId: string): void;
  get(adapterId: string): BrowserAdapter | undefined;
}

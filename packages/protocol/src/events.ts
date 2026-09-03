import type { BrowserSource } from "./source.js";
import type { RuntimeTool } from "./tool.js";

export interface RuntimeEventMeta {
  runtimeRevision: number;
  timestamp: number;
}

export type RuntimeEventBody =
  | { type: "source.added"; source: BrowserSource }
  | {
      type: "source.removed";
      sourceId: string;
      sourceGeneration: number;
    }
  | { type: "tool.added"; tool: RuntimeTool }
  | { type: "tool.updated"; tool: RuntimeTool }
  | {
      type: "tool.removed";
      runtimeId: string;
      sourceId: string;
      sourceGeneration: number;
    }
  | { type: "consent.updated" };

export type RuntimeEvent = RuntimeEventMeta & RuntimeEventBody;

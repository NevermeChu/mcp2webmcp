export type AdapterType = "extension" | "mcpb" | "fake";

export type SourceState = "connected" | "disconnected";

export interface BrowserSource {
  adapterId: string;
  sourceId: string;
  generation: number;
  browserId: string;
  tabId: string;
  origin: string;
  url: string;
  title?: string;
  adapterType: AdapterType;
  connectedAt: number;
  updatedAt: number;
  state: SourceState;
}

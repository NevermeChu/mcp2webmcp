export type AdapterType = "extension" | "cdp" | "playwright" | "mcpb" | "fake";

export type SourceState = "connected" | "stale" | "disconnected";

export interface BrowserSource {
  adapterId: string;
  sourceId: string;
  generation: number;
  browserId: string;
  profileId?: string;
  tabId: string;
  frameId?: string;
  origin: string;
  url: string;
  title?: string;
  adapterType: AdapterType;
  connectedAt: number;
  updatedAt: number;
  state: SourceState;
}

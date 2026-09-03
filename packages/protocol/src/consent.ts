export interface ConsentConfig {
  enabled: boolean;
  autoAdmit: boolean;
  path: string;
}

export interface ConsentToolRecord {
  originalName: string;
  enabled: boolean;
  admittedAt: number;
  revokedAt?: number;
}

export interface ConsentOriginRecord {
  origin: string;
  enabled: boolean;
  admittedAt: number;
  revokedAt?: number;
  tools: ConsentToolRecord[];
}

export const defaultConsentConfig: ConsentConfig = {
  enabled: true,
  autoAdmit: true,
  path: "~/.mcp2webmcp/consent.json",
};

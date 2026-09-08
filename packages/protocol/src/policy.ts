import type { BrowserSource } from "./source.js";
import type { RuntimeTool } from "./tool.js";

export type PolicyAction = "allow" | "deny" | "confirm";

export type ToolPolicyMode = PolicyAction;

export interface ToolPolicyOverride {
  origin: string;
  originalName: string;
  mode: ToolPolicyMode;
  updatedAt: number;
}

export type PolicyDecision =
  { action: "allow" } | { action: "deny"; reason: string } | { action: "confirm"; reason: string };

export interface PolicyContext {
  client?: {
    clientId?: string;
    name?: string;
  };
  tool: RuntimeTool;
  source: BrowserSource;
  input: unknown;
}

export interface PolicyRuleMatch {
  origin?: string;
  tool?: string;
  destructive?: boolean;
}

export interface PolicyRule {
  match: PolicyRuleMatch;
  action: PolicyAction;
}

export interface PolicyConfig {
  default: "allow" | "deny";
  rules: PolicyRule[];
  /** Gateway-owned persistence for exact per-origin, per-tool user overrides. */
  overridesPath?: string;
}

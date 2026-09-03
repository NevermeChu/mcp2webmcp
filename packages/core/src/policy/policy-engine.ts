import type { PolicyConfig, PolicyContext, PolicyDecision, PolicyRule } from "@mcp2webmcp/protocol";

export class PolicyEngine {
  constructor(private readonly config: PolicyConfig) {}

  evaluate(context: PolicyContext): PolicyDecision {
    let decision: PolicyDecision =
      this.config.default === "allow"
        ? { action: "allow" }
        : { action: "deny", reason: "default deny" };

    for (const rule of this.config.rules) {
      if (this.matches(rule, context)) {
        decision = this.decisionFrom(rule);
        break;
      }
    }

    if (decision.action === "allow" && context.tool.annotations?.destructiveHint) {
      return { action: "confirm", reason: "destructiveHint upgrades allow to confirm" };
    }
    return decision;
  }

  private matches(rule: PolicyRule, context: PolicyContext): boolean {
    const { match } = rule;
    if (match.origin && match.origin !== context.source.origin) return false;
    if (match.destructive === true && context.tool.annotations?.destructiveHint !== true) {
      return false;
    }
    if (match.tool) {
      if (match.tool.includes("*")) {
        if (rule.action === "allow") return false;
        if (!globMatch(match.tool, context.tool.identity.originalName)) return false;
      } else if (match.tool !== context.tool.identity.originalName) {
        return false;
      }
    }
    if (rule.action === "allow") {
      return Boolean(match.origin && match.tool && !match.tool.includes("*"));
    }
    return true;
  }

  private decisionFrom(rule: PolicyRule): PolicyDecision {
    if (rule.action === "allow") return { action: "allow" };
    if (rule.action === "confirm") {
      return { action: "confirm", reason: "policy confirm" };
    }
    return { action: "deny", reason: "policy deny" };
  }
}

function globMatch(pattern: string, value: string): boolean {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`).test(value);
}

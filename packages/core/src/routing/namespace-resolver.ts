import { createHash } from "node:crypto";
import type { BrowserSource, ToolIdentity } from "@mcp2webmcp/protocol";

const MCP_NAME_MAX = 128;

export class NamespaceResolver {
  resolve(source: BrowserSource, originalName: string): ToolIdentity {
    const digest = createHash("sha256")
      .update(
        `${source.adapterId}/${source.sourceId}/${source.generation}/${originalName}`,
        "utf8",
      )
      .digest("hex");
    return {
      adapterId: source.adapterId,
      sourceId: source.sourceId,
      sourceGeneration: source.generation,
      originalName,
      runtimeId: `rt_${digest.slice(0, 16)}`,
      mcpName: this.buildMcpName(source, originalName, digest.slice(0, 6)),
    };
  }

  buildMcpName(source: BrowserSource, originalName: string, shortHash: string): string {
    const domain = this.normalizeDomain(source.origin);
    const tab = this.sanitize(source.tabId);
    const tool = this.sanitize(originalName);
    const suffix = `__${shortHash}`;
    const prefix = `${domain}__tab${tab}__`;
    const budget = MCP_NAME_MAX - suffix.length - prefix.length;
    const clippedTool = tool.slice(0, Math.max(1, budget));
    let name = `${prefix}${clippedTool}${suffix}`;
    if (name.length > MCP_NAME_MAX) {
      name = `${name.slice(0, MCP_NAME_MAX - suffix.length)}${suffix}`;
    }
    return name.slice(0, MCP_NAME_MAX);
  }

  normalizeDomain(origin: string): string {
    const host = this.stripWww(this.hostOf(origin));
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
      return this.sanitize(host);
    }
    const parts = host.split(".").filter(Boolean);
    if (parts.length === 0) return "origin";
    if (parts.length === 1) return this.sanitize(parts[0] ?? "origin");
    if (parts.length === 2) return this.sanitize(parts[0] ?? "origin");
    return this.sanitize(`${parts[0]}_${parts[1]}`);
  }

  sanitize(value: string): string {
    const cleaned = value
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "");
    if (!cleaned) return "x";
    if (/^[0-9]/.test(cleaned)) return `t_${cleaned}`;
    return cleaned;
  }

  private hostOf(origin: string): string {
    try {
      const url = origin.includes("://") ? new URL(origin) : new URL(`https://${origin}`);
      return url.hostname.toLowerCase();
    } catch {
      return origin.toLowerCase();
    }
  }

  private stripWww(host: string): string {
    return host.startsWith("www.") ? host.slice(4) : host;
  }
}

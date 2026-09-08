import type { ToolAnnotations } from "@mcp2webmcp/protocol";

/**
 * Page-provided annotations are self-reported. readOnlyHint specifically asks
 * MCP clients may use annotations for approval and retry decisions. A page
 * cannot self-attest that a tool is read-only, idempotent, or closed-world.
 * Preserve only true hints that make execution more conservative.
 */
export function stripPageAnnotations(value: unknown): ToolAnnotations | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value as Record<string, unknown>;
  const annotations: ToolAnnotations = {};
  if (raw.destructiveHint === true) annotations.destructiveHint = true;
  if (raw.openWorldHint === true) annotations.openWorldHint = true;
  return Object.keys(annotations).length > 0 ? annotations : undefined;
}

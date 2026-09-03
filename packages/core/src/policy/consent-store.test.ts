import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FileConsentStore, MemoryConsentStore } from "./consent-store.js";

describe("MemoryConsentStore", () => {
  it("auto-admits once and keeps a revoke tombstone", () => {
    const store = new MemoryConsentStore();
    expect(store.admit("https://knowmesh.app", "search_documents")).toBe(true);
    expect(store.admit("https://knowmesh.app", "search_documents")).toBe(false);
    expect(store.allows("https://knowmesh.app", "search_documents")).toBe(true);
    expect(store.revoke("https://knowmesh.app", "search_documents")).toBe(true);
    expect(store.allows("https://knowmesh.app", "search_documents")).toBe(false);
    expect(store.admit("https://knowmesh.app", "search_documents")).toBe(false);
    expect(store.restore("https://knowmesh.app", "search_documents")).toBe(true);
    expect(store.allows("https://knowmesh.app", "search_documents")).toBe(true);
  });

  it("does not re-admit tools after the origin is revoked", () => {
    const store = new MemoryConsentStore();
    store.admit("https://knowmesh.app", "search_documents");
    store.revoke("https://knowmesh.app");
    expect(store.admit("https://knowmesh.app", "get_document")).toBe(false);
    expect(store.allows("https://knowmesh.app", "search_documents")).toBe(false);
  });
});

describe("FileConsentStore", () => {
  it("persists across instances", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-consent-"));
    const path = join(dir, "consent.json");
    const first = new FileConsentStore(path);
    first.admit("https://knowmesh.app", "echo");
    const raw = JSON.parse(readFileSync(path, "utf8")) as { origins: Record<string, unknown> };
    expect(raw.origins["https://knowmesh.app"]).toBeTruthy();
    const second = new FileConsentStore(path);
    expect(second.allows("https://knowmesh.app", "echo")).toBe(true);
  });
});

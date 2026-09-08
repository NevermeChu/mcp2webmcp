import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("picks up revokes written by another process", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-consent-"));
    const path = join(dir, "consent.json");
    const first = new FileConsentStore(path);
    first.admit("https://knowmesh.app", "echo");
    const second = new FileConsentStore(path);
    expect(second.allows("https://knowmesh.app", "echo")).toBe(true);
    expect(second.revoke("https://knowmesh.app", "echo")).toBe(true);
    expect(first.allows("https://knowmesh.app", "echo")).toBe(false);
  });

  it("keeps another process's admission when writing its own", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-consent-"));
    const path = join(dir, "consent.json");
    const first = new FileConsentStore(path);
    first.admit("https://knowmesh.app", "t1");
    const second = new FileConsentStore(path);
    second.admit("https://knowmesh.app", "t2");
    first.admit("https://knowmesh.app", "t3");
    expect(first.allows("https://knowmesh.app", "t2")).toBe(true);
    const third = new FileConsentStore(path);
    expect(third.allows("https://knowmesh.app", "t1")).toBe(true);
    expect(third.allows("https://knowmesh.app", "t2")).toBe(true);
    expect(third.allows("https://knowmesh.app", "t3")).toBe(true);
  });

  it("fails closed without overwriting a corrupt consent file", () => {
    const dir = mkdtempSync(join(tmpdir(), "mcp2webmcp-consent-"));
    const path = join(dir, "consent.json");
    writeFileSync(path, "not-json", "utf8");
    const store = new FileConsentStore(path);

    expect(store.allows("https://knowmesh.app", "echo")).toBe(false);
    expect(store.admit("https://knowmesh.app", "echo")).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("not-json");
  });
});

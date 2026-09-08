import { describe, expect, it } from "vitest";
import { applyPageSnapshot, originFromTabUrl } from "./background-core.js";

const base = {
  runtimePresent: true,
  runtimeError: undefined,
  tools: [{ originalName: "echo" }],
};

describe("originFromTabUrl", () => {
  it("accepts http(s) and normalizes to origin", () => {
    expect(originFromTabUrl("https://knowmesh.app/docs?x=1")).toBe("https://knowmesh.app");
    expect(originFromTabUrl("http://127.0.0.1:18081/")).toBe("http://127.0.0.1:18081");
  });

  it("rejects non-http schemes and garbage", () => {
    expect(originFromTabUrl("file:///C:/tmp/x.html")).toBeUndefined();
    expect(originFromTabUrl("chrome://extensions")).toBeUndefined();
    expect(originFromTabUrl("not a url")).toBeUndefined();
  });
});

describe("applyPageSnapshot", () => {
  it("starts a new tab at generation 1", () => {
    const merged = applyPageSnapshot(undefined, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: "p1",
      ...base,
    });
    expect(merged.kind).toBe("new");
    expect(merged.reason).toBe("connect");
    expect(merged.state.generation).toBe(1);
    expect(merged.state.pageInstanceId).toBe("p1");
  });

  it("does not bump when the same page re-snapshots", () => {
    const first = applyPageSnapshot(undefined, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: "p1",
      ...base,
    }).state;
    const merged = applyPageSnapshot(first, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: "p1",
      ...base,
    });
    expect(merged.kind).toBe("update");
    expect(merged.state.generation).toBe(1);
  });

  it("bumps generation on page reload (new pageInstanceId)", () => {
    const first = applyPageSnapshot(undefined, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: "p1",
      ...base,
    }).state;
    const merged = applyPageSnapshot(first, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: "p2",
      ...base,
    });
    expect(merged.kind).toBe("bump");
    expect(merged.reason).toBe("reload");
    expect(merged.state.generation).toBe(2);
    expect(merged.state.pageInstanceId).toBe("p2");
  });

  it("bumps generation on navigation (url/origin change)", () => {
    const first = applyPageSnapshot(undefined, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: "p1",
      ...base,
    }).state;
    const merged = applyPageSnapshot(first, {
      origin: "https://b.example",
      url: "https://b.example/",
      title: "B",
      pageInstanceId: "p1",
      ...base,
    });
    expect(merged.kind).toBe("bump");
    expect(merged.reason).toBe("navigate");
    expect(merged.state.generation).toBe(2);
  });

  it("backfills a missing pageInstanceId without bumping", () => {
    const first = applyPageSnapshot(undefined, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: undefined,
      ...base,
    }).state;
    const merged = applyPageSnapshot(first, {
      origin: "https://a.example",
      url: "https://a.example/",
      title: "A",
      pageInstanceId: "p9",
      ...base,
    });
    expect(merged.kind).toBe("update");
    expect(merged.state.pageInstanceId).toBe("p9");
    expect(merged.state.generation).toBe(1);
  });
});

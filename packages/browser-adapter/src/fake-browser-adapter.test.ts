import { describe, expect, it } from "vitest";
import { discoveredTool, FakeBrowserAdapter } from "./fake-browser-adapter.js";
import { testSource } from "../../../tests/helpers.js";

describe("FakeBrowserAdapter", () => {
  it("connects, registers, invokes, and disconnects", async () => {
    const adapter = new FakeBrowserAdapter("fake-1");
    await adapter.start();
    const events: string[] = [];
    adapter.subscribe((event) => events.push(event.type));
    adapter.connectSource(testSource({ adapterId: "fake-1" }));
    adapter.registerTool("tab-18", discoveredTool("echo"));
    const result = await adapter.invokeTool(
      {
        requestId: "r1",
        sourceId: "tab-18",
        sourceGeneration: 1,
        originalName: "echo",
        input: { message: "hi" },
      },
      { signal: new AbortController().signal, deadline: Date.now() + 1000 },
    );
    expect(result.content[0]).toMatchObject({ text: JSON.stringify({ message: "hi" }) });
    adapter.unregisterTool("tab-18", "echo");
    adapter.disconnectSource("tab-18");
    expect(events).toContain("source.connected");
    expect(events).toContain("tool.registered");
    expect(events).toContain("tool.unregistered");
    expect(events).toContain("source.disconnected");
    expect(await adapter.listSources()).toHaveLength(0);
  });
});

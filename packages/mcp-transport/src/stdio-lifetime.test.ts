import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { installStdioLifetime } from "./stdio-lifetime.js";

describe("installStdioLifetime", () => {
  it("treats stdin end as hangup so Cursor Reload can drop the Gateway", async () => {
    const stdin = new PassThrough();
    const reasons: string[] = [];
    installStdioLifetime({
      stdin,
      onHangup: (reason) => {
        reasons.push(reason);
      },
    });
    stdin.resume();
    stdin.end();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(["stdin-end", "stdin-close"]).toContain(reasons[0]);
  });

  it("fires hangup only once", async () => {
    const stdin = new PassThrough();
    let count = 0;
    installStdioLifetime({
      stdin,
      onHangup: () => {
        count += 1;
      },
    });
    stdin.end();
    stdin.destroy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(count).toBe(1);
  });
});

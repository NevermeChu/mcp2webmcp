import { describe, expect, it } from "vitest";
import { sanitizeLogData } from "./log.js";

describe("sanitizeLogData", () => {
  it("drops secret-like keys and non-scalar payloads", () => {
    expect(
      sanitizeLogData({
        originalName: "echo",
        cookie: "sid=1",
        authorization: "Bearer x",
        args: { message: "hi" },
        names: ["echo", "add"],
      }),
    ).toEqual({
      originalName: "echo",
      names: ["echo", "add"],
    });
  });
});

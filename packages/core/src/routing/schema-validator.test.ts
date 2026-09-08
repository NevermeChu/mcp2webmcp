import { describe, expect, it } from "vitest";
import { RuntimeError } from "@mcp2webmcp/protocol";
import { SchemaValidator } from "./schema-validator.js";

const limits = {
  maxToolsTotal: 500,
  maxToolsPerSource: 100,
  maxInputBytes: 1_048_576,
  maxResultBytes: 4_194_304,
  maxSchemaBytes: 262_144,
  maxSchemaDepth: 32,
};

describe("SchemaValidator", () => {
  it("enforces JSON Schema 2020-12 unevaluatedProperties", () => {
    const validator = new SchemaValidator(limits);
    const schema = {
      type: "object",
      properties: { known: { type: "string" } },
      unevaluatedProperties: false,
    };
    expect(() => validator.validate(schema, { known: "ok" })).not.toThrow();
    expect(() => validator.validate(schema, { known: "ok", extra: true })).toThrow(RuntimeError);
  });

  it("rejects regex-bearing schemas from untrusted pages", () => {
    const validator = new SchemaValidator(limits);
    expect(() =>
      validator.validate({ type: "string", pattern: "^(a+)+$" }, "aaaaaaaaaaaaaaaa!"),
    ).toThrow(/pattern is disabled/);
  });

  it("does not confuse a property named pattern with the pattern keyword", () => {
    const validator = new SchemaValidator(limits);
    expect(() =>
      validator.validate(
        { type: "object", properties: { pattern: { type: "string" } } },
        { pattern: "plain data" },
      ),
    ).not.toThrow();
  });
});

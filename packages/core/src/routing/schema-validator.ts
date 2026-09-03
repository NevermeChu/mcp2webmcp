import { createHash } from "node:crypto";
import AjvDefault from "ajv";
import type { ValidateFunction } from "ajv";
import { RuntimeError, type ResourceLimits } from "@mcp2webmcp/protocol";

type AjvConstructor = new (options?: object) => {
  compile(schema: object): ValidateFunction;
  errorsText(errors: ValidateFunction["errors"]): string;
};

const Ajv = AjvDefault as unknown as AjvConstructor;

export class SchemaValidator {
  private readonly ajv: InstanceType<AjvConstructor>;
  private readonly cache = new Map<string, ValidateFunction>();

  constructor(private readonly limits: ResourceLimits) {
    this.ajv = new Ajv({
      allErrors: true,
      strict: false,
      validateSchema: false,
      addUsedSchema: false,
    });
  }

  validate(schema: Record<string, unknown>, input: unknown): void {
    const serialized = JSON.stringify(schema);
    if (Buffer.byteLength(serialized, "utf8") > this.limits.maxSchemaBytes) {
      throw new RuntimeError("SCHEMA_TOO_LARGE", "tool input schema exceeds maxSchemaBytes");
    }
    if (schemaDepth(schema) > this.limits.maxSchemaDepth) {
      throw new RuntimeError("INVALID_INPUT", "tool input schema exceeds maxSchemaDepth");
    }
    const key = createHash("sha256").update(serialized).digest("hex");
    let validator = this.cache.get(key);
    if (!validator) {
      validator = this.ajv.compile(schema);
      this.cache.set(key, validator);
    }
    if (!validator(input)) {
      throw new RuntimeError("INVALID_INPUT", this.ajv.errorsText(validator.errors));
    }
  }
}

function schemaDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") return depth;
  if (Array.isArray(value)) {
    return Math.max(depth, ...value.map((item) => schemaDepth(item, depth + 1)));
  }
  const children = Object.values(value as Record<string, unknown>);
  if (children.length === 0) return depth + 1;
  return Math.max(...children.map((child) => schemaDepth(child, depth + 1)));
}

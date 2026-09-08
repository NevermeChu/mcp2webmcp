import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import type { ValidateFunction } from "ajv";
import { RuntimeError, type ResourceLimits } from "@mcp2webmcp/protocol";

type AjvConstructor = new (options?: object) => {
  compile(schema: object): ValidateFunction;
  errorsText(errors: ValidateFunction["errors"]): string;
};

const Ajv = Ajv2020 as unknown as AjvConstructor;

const MAX_VALIDATOR_CACHE = 256;
const MAX_SCHEMA_NODES = 2_048;

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
    assertSafeSchema(schema);
    const key = createHash("sha256").update(serialized).digest("hex");
    let validator = this.cache.get(key);
    if (validator) {
      // Refresh LRU position.
      this.cache.delete(key);
    } else {
      try {
        validator = this.ajv.compile(schema);
      } catch (error) {
        throw new RuntimeError(
          "INVALID_INPUT",
          `invalid tool input schema: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (this.cache.size >= MAX_VALIDATOR_CACHE) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) this.cache.delete(oldest);
      }
    }
    this.cache.set(key, validator);
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

/**
 * Page schemas are untrusted and validation runs on the Gateway event loop.
 * JavaScript RegExp has no execution deadline, so regex-bearing keywords are
 * rejected instead of pretending a string-length cap prevents ReDoS.
 */
function assertSafeSchema(node: unknown): void {
  let nodes = 0;
  countNodes(node);
  rejectRegexKeywords(node);

  function countNodes(value: unknown): void {
    nodes += 1;
    if (nodes > MAX_SCHEMA_NODES) {
      throw new RuntimeError("INVALID_INPUT", `tool schema exceeds ${MAX_SCHEMA_NODES} nodes`);
    }
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const item of value) countNodes(item);
      return;
    }
    for (const child of Object.values(value as Record<string, unknown>)) {
      countNodes(child);
    }
  }
}

const SCHEMA_MAP_KEYWORDS = new Set(["properties", "$defs", "definitions", "dependentSchemas"]);
const SCHEMA_VALUE_KEYWORDS = new Set([
  "additionalProperties",
  "unevaluatedProperties",
  "propertyNames",
  "items",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "unevaluatedItems",
  "additionalItems",
  "contentSchema",
]);
const SCHEMA_ARRAY_KEYWORDS = new Set(["prefixItems", "allOf", "anyOf", "oneOf"]);

function rejectRegexKeywords(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  const schema = value as Record<string, unknown>;
  for (const key of ["pattern", "patternProperties"]) {
    if (Object.hasOwn(schema, key)) {
      throw new RuntimeError(
        "INVALID_INPUT",
        `tool schema keyword ${key} is disabled for untrusted page schemas`,
      );
    }
  }
  for (const key of SCHEMA_MAP_KEYWORDS) {
    const map = schema[key];
    if (!map || typeof map !== "object" || Array.isArray(map)) continue;
    for (const child of Object.values(map as Record<string, unknown>)) rejectRegexKeywords(child);
  }
  for (const key of SCHEMA_VALUE_KEYWORDS) rejectRegexKeywords(schema[key]);
  for (const key of SCHEMA_ARRAY_KEYWORDS) {
    const children = schema[key];
    if (Array.isArray(children)) for (const child of children) rejectRegexKeywords(child);
  }
}

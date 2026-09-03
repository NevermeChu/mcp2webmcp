import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@mcp2webmcp/protocol": path.join(root, "packages/protocol/src/index.ts"),
      "@mcp2webmcp/core": path.join(root, "packages/core/src/index.ts"),
      "@mcp2webmcp/browser-adapter": path.join(root, "packages/browser-adapter/src/index.ts"),
      "@mcp2webmcp/mcp-transport": path.join(root, "packages/mcp-transport/src/index.ts"),
    },
  },
  test: {
    include: ["tests/e2e-extension/**/*.e2e.test.ts"],
    environment: "node",
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
});

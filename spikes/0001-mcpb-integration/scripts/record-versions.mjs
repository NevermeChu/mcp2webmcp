import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as relay from "@mcp-b/webmcp-local-relay";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function pkgVersion(name) {
  const pkg = require(path.join(root, "node_modules", name, "package.json"));
  return pkg.version;
}

const snapshot = {
  capturedAt: new Date().toISOString(),
  node: process.version,
  platform: `${os.platform()} ${os.release()} ${os.arch()}`,
  packages: {
    "@mcp-b/webmcp-local-relay": pkgVersion("@mcp-b/webmcp-local-relay"),
    "@mcp-b/global": pkgVersion("@mcp-b/global"),
    "@modelcontextprotocol/client": pkgVersion("@modelcontextprotocol/client"),
    "@modelcontextprotocol/core": pkgVersion("@modelcontextprotocol/core"),
    "@modelcontextprotocol/server": pkgVersion("@modelcontextprotocol/server"),
  },
  mcpbPublicExports: Object.keys(relay).sort(),
  webmcp: {
    spec: "W3C WebML CG Draft, document.modelContext.registerTool / getTools / toolchange",
    specUrl: "https://webmachinelearning.github.io/webmcp/",
    chromeTestingFlag: "chrome://flags/#enable-webmcp-testing",
    nativeChromeOnThisMachine:
      "not installed at default path; spike uses @mcp-b/global 5.1.0 as the page runtime",
    hostBrowserForE2E: "Playwright as test harness only, not as a product BrowserAdapter",
  },
  referenceMcpClient: {
    package: "@modelcontextprotocol/client",
    version: pkgVersion("@modelcontextprotocol/client"),
    transport: "@modelcontextprotocol/client/stdio StdioClientTransport",
  },
};

const out = path.join(root, "versions.snapshot.json");
fs.writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
process.stdout.write(`${out}\n`);

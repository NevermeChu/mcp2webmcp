import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(pkgRoot, "public");
const repoRoot = path.resolve(pkgRoot, "../../..");

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

function findVendor(relFromPackage) {
  const candidates = [
    path.join(pkgRoot, "node_modules", relFromPackage),
    path.join(repoRoot, "node_modules", relFromPackage),
    path.join(repoRoot, "packages/browser-adapter/node_modules", relFromPackage),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(`missing vendor file ${relFromPackage}; run pnpm install`);
  }
  return found;
}

const vendor = {
  "/vendor/global.iife.js": () => findVendor("@mcp-b/global/dist/index.iife.js"),
  "/vendor/embed.js": () => findVendor("@mcp-b/webmcp-local-relay/dist/browser/embed.js"),
  "/vendor/widget.html": () => findVendor("@mcp-b/webmcp-local-relay/dist/browser/widget.html"),
};

export function createFixtureServer(options = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const vendorLoader = vendor[url.pathname];
    if (vendorLoader) {
      const vendorPath = vendorLoader();
      fs.readFile(vendorPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("missing vendor file");
          return;
        }
        res.writeHead(200, {
          "content-type": mime[path.extname(vendorPath)] ?? "application/octet-stream",
          "access-control-allow-origin": "*",
        });
        res.end(data);
      });
      return;
    }

    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
    const filePath = path.join(publicDir, relative);
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const relayPort = String(
        options.relayPort ?? process.env.MCP2WEBMCP_E2E_RELAY_PORT ?? "9333",
      );
      const body = data.replaceAll("__RELAY_PORT__", relayPort);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MCP2WEBMCP_E2E_FIXTURE_PORT ?? "18080");
  const server = createFixtureServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`webmcp-demo http://127.0.0.1:${port} (cooperative embed)\n`);
  });
}

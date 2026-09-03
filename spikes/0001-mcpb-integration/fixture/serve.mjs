import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const spikeRoot = path.resolve(root, "..");
const listenPort = Number(process.env.MCP2WEBMCP_SPIKE_FIXTURE_PORT ?? "18080");

const vendor = {
  "/vendor/global.iife.js": path.join(
    spikeRoot,
    "node_modules/@mcp-b/global/dist/index.iife.js",
  ),
  "/vendor/embed.js": path.join(
    spikeRoot,
    "node_modules/@mcp-b/webmcp-local-relay/dist/browser/embed.js",
  ),
  "/vendor/widget.html": path.join(
    spikeRoot,
    "node_modules/@mcp-b/webmcp-local-relay/dist/browser/widget.html",
  ),
};

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
};

export function createFixtureServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1`);
    const vendorPath = vendor[url.pathname];
    if (vendorPath) {
      fs.readFile(vendorPath, (err, data) => {
        if (err) {
          res.writeHead(404);
          res.end("missing vendor file; run npm install in the spike directory");
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

    const filePath = path.join(root, url.pathname === "/" ? "index.html" : url.pathname);
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const relayPort = process.env.MCP2WEBMCP_SPIKE_RELAY_PORT ?? "19333";
      const body = data.replaceAll("__RELAY_PORT__", relayPort);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(body);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createFixtureServer();
  server.listen(listenPort, "127.0.0.1", () => {
    process.stdout.write(
      `fixture http://127.0.0.1:${listenPort} relay ${process.env.MCP2WEBMCP_SPIKE_RELAY_PORT ?? "19333"}\n`,
    );
  });
}

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(pkgRoot, "public");

export function createExtensionFixtureServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const relative = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "");
    const filePath = path.join(publicDir, relative);
    fs.readFile(filePath, "utf8", (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(filePath);
      const type = ext === ".js" ? "text/javascript; charset=utf-8" : "text/html; charset=utf-8";
      res.writeHead(200, { "content-type": type });
      res.end(data);
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.MCP2WEBMCP_E2E_FIXTURE_PORT ?? "18081");
  const server = createExtensionFixtureServer();
  server.listen(port, "127.0.0.1", () => {
    process.stdout.write(`webmcp-extension-demo http://127.0.0.1:${port} (no embed)\n`);
  });
}

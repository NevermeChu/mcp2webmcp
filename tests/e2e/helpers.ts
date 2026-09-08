import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium, type Browser } from "playwright";

export function unusedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("failed to allocate port"));
        return;
      }
      const { port } = address;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

export function childEnv(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  return { ...env, ...extra };
}

export async function waitFor<T>(
  label: string,
  fn: () => Promise<T | undefined | false | null>,
  timeoutMs = 45_000,
): Promise<T> {
  const started = Date.now();
  let lastError: unknown;
  while (Date.now() - started < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`${label} timed out: ${String(lastError ?? "predicate never succeeded")}`);
}

export function textContent(result: { content?: Array<{ type?: string; text?: string }> }): string {
  return (result.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

export interface ListedToolRow {
  mcpName: string;
  originalName: string;
  origin?: string;
}

export async function listedRows(client: Client): Promise<ListedToolRow[]> {
  const result = await client.callTool({ name: "webmcp_list_tools", arguments: {} });
  return JSON.parse(textContent(result)) as ListedToolRow[];
}

export async function waitForOriginal(
  client: Client,
  originalName: string,
  origin?: string,
): Promise<ListedToolRow> {
  try {
    return await waitFor(`${originalName} on ${origin ?? "any origin"}`, async () => {
      const rows = await listedRows(client);
      return rows.find(
        (row) => row.originalName === originalName && (!origin || row.origin === origin),
      );
    });
  } catch (error) {
    const rows = await listedRows(client).catch(() => []);
    throw new Error(`${String(error)}; listed=${JSON.stringify(rows)}`);
  }
}

export async function connectGateway(
  repoRoot: string,
  configPath: string,
  stderrPath: string,
): Promise<{ client: Client; transport: StdioClientTransport }> {
  const entry = path.join(repoRoot, "apps/gateway/dist/main.js");
  if (!fs.existsSync(entry)) {
    throw new Error(`missing ${entry}; run pnpm build before E2E`);
  }
  const client = new Client({ name: "mcp2webmcp-e2e", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entry, "--config", configPath],
    cwd: repoRoot,
    env: childEnv({}),
    stderr: "pipe",
  });
  transport.stderr?.pipe(fs.createWriteStream(stderrPath));
  await client.connect(transport);
  return { client, transport };
}

export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "msedge" });
  } catch {
    return chromium.launch();
  }
}

export function writeGatewayConfig(
  filePath: string,
  options: {
    origins: string[];
    relayPort: number;
    persistPath: string;
    auditPath: string;
  },
): void {
  const consentPath = options.auditPath
    .replace(/audit\.jsonl$/i, "consent.json")
    .replaceAll("\\", "/");
  fs.writeFileSync(
    filePath,
    `
runtime:
  name: mcp2webmcp-e2e
  logLevel: warn
  invocationDeadlineMs: 65000
browser:
  adapter: mcpb
  allowedOrigins:
${options.origins.map((origin) => `    - "${origin}"`).join("\n")}
  mcpb:
    host: "127.0.0.1"
    port: ${options.relayPort}
    persistPath: "${options.persistPath.replaceAll("\\", "/")}"
    relayId: mcp2webmcp-e2e
policy:
  default: deny
  rules:
    - match:
        tool: "safe_backup"
      action: confirm
    - match:
        destructive: true
      action: confirm
consent:
  enabled: true
  autoAdmit: true
  path: "${consentPath}"
audit:
  enabled: true
  path: "${options.auditPath.replaceAll("\\", "/")}"
`,
  );
}

export function writeExtensionGatewayConfig(
  filePath: string,
  options: {
    origins: string[];
    extensionPort: number;
    auditPath: string;
    authToken: string;
  },
): void {
  const consentPath = options.auditPath
    .replace(/audit\.jsonl$/i, "consent.json")
    .replaceAll("\\", "/");
  fs.writeFileSync(
    filePath,
    `
runtime:
  name: mcp2webmcp-e2e-extension
  logLevel: warn
  invocationDeadlineMs: 65000
browser:
  adapter: extension
  allowedOrigins:
${options.origins.map((origin) => `    - "${origin}"`).join("\n")}
  extension:
    host: "127.0.0.1"
    port: ${options.extensionPort}
    authToken: "${options.authToken}"
policy:
  default: deny
  rules:
    - match:
        destructive: true
      action: confirm
consent:
  enabled: true
  autoAdmit: true
  path: "${consentPath}"
audit:
  enabled: true
  path: "${options.auditPath.replaceAll("\\", "/")}"
`,
  );
}

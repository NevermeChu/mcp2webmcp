const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_HOSTS.has(host.trim().toLowerCase())) {
    throw new Error(`mcpb relay host must be loopback (127.0.0.1 / ::1 / localhost), got ${host}`);
  }
}

export function assertExplicitOrigins(origins: string[]): void {
  if (origins.length === 0) {
    throw new Error("mcpb adapter requires an explicit allowedOrigins list");
  }
  if (origins.some((origin) => origin === "*")) {
    throw new Error("mcpb allowedOrigins must not include *");
  }
}

export function normalizeLoopbackHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "localhost") return "127.0.0.1";
  return host.trim();
}

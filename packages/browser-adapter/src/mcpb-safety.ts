const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export function assertLoopbackHost(host: string): void {
  if (!LOOPBACK_HOSTS.has(host.trim().toLowerCase())) {
    throw new Error(`adapter host must be loopback (127.0.0.1 / ::1 / localhost), got ${host}`);
  }
}

export function assertExplicitOrigins(origins: string[]): void {
  assertOriginPolicy(origins);
  if (origins.length === 0) {
    throw new Error("adapter requires an explicit allowedOrigins list");
  }
}

export function assertOriginPolicy(origins: string[]): void {
  if (origins.some((origin) => origin === "*")) {
    throw new Error("allowedOrigins must not include *");
  }
}

export function originIsAllowed(allowedOrigins: readonly string[], origin: string): boolean {
  if (allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

export function normalizeLoopbackHost(host: string): string {
  const trimmed = host.trim().toLowerCase();
  if (trimmed === "localhost") return "127.0.0.1";
  return host.trim();
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.trim().toLowerCase().replace(/^::ffff:/, "");
  return LOOPBACK_HOSTS.has(normalized);
}

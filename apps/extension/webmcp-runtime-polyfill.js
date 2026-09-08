/**
 * Deletable page WebMCP runtime (MAIN world). Not an MCP server.
 * Remove this file + the manifest js entry when browsers ship document.modelContext.
 * See docs/adr/0009-extension-webmcp-runtime-polyfill.md
 */
(function mcp2webmcpWebMcpRuntimePolyfill(globalRef) {
  const POLYFILL_BRAND = Symbol.for("mcp2webmcp.webmcp-runtime-polyfill");

  function createWebMcpRuntimePolyfill() {
    const registered = new Map();

    async function registerTool(def, options) {
      if (!def || typeof def.name !== "string" || def.name.length === 0) {
        throw new TypeError("registerTool: name must be a non-empty string");
      }
      if (typeof def.description !== "string") {
        throw new TypeError("registerTool: description must be a string");
      }
      if (typeof def.execute !== "function") {
        throw new TypeError("registerTool: execute must be a function");
      }
      if (registered.has(def.name)) {
        throw new Error(`registerTool: tool already registered: ${def.name}`);
      }
      registered.set(def.name, def);
      const signal = options?.signal;
      if (signal && typeof signal.addEventListener === "function") {
        const drop = () => {
          registered.delete(def.name);
        };
        if (signal.aborted) {
          drop();
        } else {
          signal.addEventListener("abort", drop, { once: true });
        }
      }
    }

    function getTools() {
      return [...registered.values()].map((def) => ({
        name: def.name,
        description: def.description,
        inputSchema: def.inputSchema,
        annotations: def.annotations,
      }));
    }

    const host = {
      registerTool,
      getTools,
    };
    host[POLYFILL_BRAND] = true;
    return host;
  }

  function hasRegisterTool(owner) {
    if (!owner) return false;
    try {
      const ctx = owner.modelContext;
      return Boolean(ctx && typeof ctx.registerTool === "function");
    } catch {
      return false;
    }
  }

  function installWebMcpRuntimePolyfill(env) {
    const documentRef = env.document;
    const navigatorRef = env.navigator;
    if (env.isSecureContext !== true) return false;
    if (hasRegisterTool(documentRef) || hasRegisterTool(navigatorRef)) return false;
    const existing =
      (documentRef && documentRef.modelContext) || (navigatorRef && navigatorRef.modelContext);
    if (existing && existing[POLYFILL_BRAND]) return false;

    const host = createWebMcpRuntimePolyfill();
    try {
      if (documentRef) {
        Object.defineProperty(documentRef, "modelContext", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: host,
        });
      }
      if (navigatorRef) {
        Object.defineProperty(navigatorRef, "modelContext", {
          configurable: true,
          enumerable: true,
          writable: true,
          value: host,
        });
      }
    } catch {
      return false;
    }
    return true;
  }

  if (typeof globalRef.document !== "undefined" || typeof globalRef.navigator !== "undefined") {
    installWebMcpRuntimePolyfill(globalRef);
  }

  if (typeof globalRef.window === "undefined") {
    globalRef.createWebMcpRuntimePolyfill = createWebMcpRuntimePolyfill;
    globalRef.installWebMcpRuntimePolyfill = installWebMcpRuntimePolyfill;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);

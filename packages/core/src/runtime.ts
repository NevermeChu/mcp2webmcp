import type { BrowserAdapter, ResourceLimits, RuntimeConfig } from "@mcp2webmcp/protocol";
import { AuditLogger } from "./audit/audit-logger.js";
import { RuntimeEventBus } from "./events/runtime-event-bus.js";
import { LifecycleManager } from "./lifecycle/lifecycle-manager.js";
import { ConfirmationManager } from "./policy/confirmation-manager.js";
import { PolicyEngine } from "./policy/policy-engine.js";
import { InMemoryAdapterRegistry } from "./registry/adapter-registry.js";
import { SourceRegistry } from "./registry/source-registry.js";
import { ToolRegistry } from "./registry/tool-registry.js";
import { NamespaceResolver } from "./routing/namespace-resolver.js";
import { ToolRouter } from "./routing/tool-router.js";

export interface Runtime {
  sources: SourceRegistry;
  tools: ToolRegistry;
  adapters: InMemoryAdapterRegistry;
  events: RuntimeEventBus;
  names: NamespaceResolver;
  lifecycle: LifecycleManager;
  policy: PolicyEngine;
  confirmation: ConfirmationManager;
  audit: AuditLogger;
  router: ToolRouter;
  limits: ResourceLimits;
  attach(adapter: BrowserAdapter): Promise<void>;
}

export function createRuntime(config: RuntimeConfig): Runtime {
  const sources = new SourceRegistry();
  const tools = new ToolRegistry();
  const adapters = new InMemoryAdapterRegistry();
  const events = new RuntimeEventBus();
  const names = new NamespaceResolver();
  const lifecycle = new LifecycleManager(sources, tools, events, names, config.limits);
  const policy = new PolicyEngine(config.policy);
  const confirmation = new ConfirmationManager();
  const audit = new AuditLogger(config.audit);
  const router = new ToolRouter({
    sources,
    tools,
    adapters,
    policy,
    confirmation,
    audit,
    limits: config.limits,
    invocationDeadlineMs: config.runtime.invocationDeadlineMs,
  });

  return {
    sources,
    tools,
    adapters,
    events,
    names,
    lifecycle,
    policy,
    confirmation,
    audit,
    router,
    limits: config.limits,
    async attach(adapter: BrowserAdapter) {
      adapters.register(adapter);
      await adapter.start();
      await lifecycle.attach(adapter);
    },
  };
}

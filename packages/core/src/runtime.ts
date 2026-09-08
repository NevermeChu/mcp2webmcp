import type {
  BrowserAdapter,
  ResourceLimits,
  RuntimeConfig,
  RuntimeEvent,
} from "@mcp2webmcp/protocol";
import { AuditLogger } from "./audit/audit-logger.js";
import { RuntimeEventBus } from "./events/runtime-event-bus.js";
import { RuntimeLogger } from "./log/runtime-logger.js";
import { LifecycleManager } from "./lifecycle/lifecycle-manager.js";
import {
  DisabledConsentStore,
  FileConsentStore,
  type ConsentStore,
} from "./policy/consent-store.js";
import { PolicyEngine } from "./policy/policy-engine.js";
import {
  FilePolicyOverrideStore,
  type PolicyOverrideStore,
} from "./policy/policy-override-store.js";
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
  audit: AuditLogger;
  log: RuntimeLogger;
  router: ToolRouter;
  consent: ConsentStore;
  policyOverrides: PolicyOverrideStore;
  limits: ResourceLimits;
  attach(adapter: BrowserAdapter): Promise<void>;
}

export function createRuntime(config: RuntimeConfig): Runtime {
  const sources = new SourceRegistry();
  const tools = new ToolRegistry();
  const adapters = new InMemoryAdapterRegistry();
  const events = new RuntimeEventBus();
  const names = new NamespaceResolver();
  const consent: ConsentStore = config.consent.enabled
    ? new FileConsentStore(config.consent.path, {
        enabled: config.consent.enabled,
        autoAdmit: config.consent.autoAdmit,
      })
    : new DisabledConsentStore();
  const lifecycle = new LifecycleManager(sources, tools, events, names, config.limits, consent);
  const policyOverrides = new FilePolicyOverrideStore(
    config.policy.overridesPath ?? `${config.consent.path}.policy-overrides.json`,
  );
  const policy = new PolicyEngine(config.policy, consent, policyOverrides);
  const audit = new AuditLogger(config.audit);
  const log = new RuntimeLogger({
    path: config.runtime.logPath,
    logLevel: config.runtime.logLevel,
    maxBytes: config.runtime.logMaxBytes,
    stderr: Boolean(config.runtime.logPath),
  });
  events.subscribe((event) => logRuntimeEvent(log, event));
  const router = new ToolRouter({
    sources,
    tools,
    adapters,
    policy,
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
    audit,
    log,
    router,
    consent,
    policyOverrides,
    limits: config.limits,
    async attach(adapter: BrowserAdapter) {
      adapters.register(adapter);
      await adapter.start();
      log.info("gateway", "adapter.attached", { adapterId: adapter.adapterId, type: adapter.type });
      await lifecycle.attach(adapter);
    },
  };
}

function logRuntimeEvent(log: RuntimeLogger, event: RuntimeEvent): void {
  if (event.type === "source.added") {
    log.info("gateway", "source.added", {
      adapterId: event.source.adapterId,
      sourceId: event.source.sourceId,
      origin: event.source.origin,
      generation: event.source.generation,
    });
    return;
  }
  if (event.type === "source.removed") {
    log.info("gateway", "source.removed", {
      sourceId: event.sourceId,
      sourceGeneration: event.sourceGeneration,
    });
    return;
  }
  if (event.type === "tool.added") {
    log.info("gateway", "tool.added", {
      mcpName: event.tool.identity.mcpName,
      originalName: event.tool.identity.originalName,
      sourceId: event.tool.identity.sourceId,
      sourceGeneration: event.tool.identity.sourceGeneration,
    });
    return;
  }
  if (event.type === "tool.updated") {
    log.debug("gateway", "tool.updated", {
      mcpName: event.tool.identity.mcpName,
      sourceGeneration: event.tool.identity.sourceGeneration,
    });
    return;
  }
  if (event.type === "tool.removed") {
    log.info("gateway", "tool.removed", {
      runtimeId: event.runtimeId,
      sourceId: event.sourceId,
      sourceGeneration: event.sourceGeneration,
    });
    return;
  }
  if (event.type === "consent.updated") {
    log.info("gateway", "consent.updated");
  }
}

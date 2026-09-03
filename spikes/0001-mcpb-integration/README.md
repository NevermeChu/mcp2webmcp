# Spike 0001 — MCP-B integration (disposable)

Minimal cooperative-page + public-API proof for WebMCP Gateway (mcp2webmcp) Phase -1.

This package is **not** the product Core. It must not grow into the monorepo.

## Test

```bash
npm install
npm test
```

`tests/real-chain.test.ts` launches Microsoft Edge via Playwright (`channel: "msedge"`), serves `fixture/`, starts `src/stdio-relay.mjs` over stdio, and calls the page `echo` tool through `@modelcontextprotocol/client`.

Playwright is a test harness only.

## Layout

```text
fixture/          cooperative page + local MCP-B embed/global vendor routes
src/stdio-relay.mjs   LocalRelayMcpServer + invokeTool policy wrap
tests/            public API, policy boundary, real chain
```

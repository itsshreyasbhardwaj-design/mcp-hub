# Architecture

MCP Hub is a control plane for Model Context Protocol servers. It records what
servers exist, what they expose, whether they work, who may call them, and what
was actually called.

This document explains the shape of the system and, where a decision was not
obvious, why it was made that way.

## The central concept

```
Discover → Register → Validate → Test → Publish → Deploy → Monitor → Version → Govern
```

Each arrow is a deliberate, separate action. In particular:

- **Registering does not connect.** Adding an entry to the registry records
  metadata and nothing else. Discovery is a second, explicit step. This matters
  because a registry that connects on write turns "paste a config file" into
  "execute arbitrary endpoints".
- **Publishing freezes.** Once a version is published its capability surface is
  immutable; re-running discovery against it is refused rather than silently
  overwriting what consumers pinned.
- **Executing is gated.** Every tool call passes scope, permission rules, a
  sensitive-tool acknowledgement, an argument-bound approval, payload limits and
  transport policy before any bytes leave the process.

## Layers

```
┌─────────────────────────────────────────────────────────────────────┐
│ apps/web (Next.js)          apps/api (node:http)     apps/worker    │
│ dashboard + /api/v1/*       /api/v1/* only           jobs           │
└───────────────┬─────────────────────┬──────────────────────┬────────┘
                │                     │                      │
                └─────────────────────┴──────────────────────┘
                                      │
                        ┌─────────────▼──────────────┐
                        │ @mcp-hub/api               │
                        │ router · auth · services   │
                        └─────────────┬──────────────┘
                                      │
   ┌──────────┬──────────┬────────────┼────────────┬──────────┬────────┐
   │ validator│versioning│ permissions│  testing   │  search  │assistant│
   └──────────┴──────────┴────────────┴────────────┴──────────┴────────┘
                                      │
                 ┌────────────────────┼────────────────────┐
                 │                    │                    │
          ┌──────▼──────┐   ┌─────────▼────────┐   ┌───────▼───────┐
          │ mcp-client  │   │    security      │   │   database    │
          │ stdio · HTTP│   │ ssrf · crypto ·  │   │ pg | PGlite   │
          │             │   │ risk · untrusted │   │ repositories  │
          └──────┬──────┘   └──────────────────┘   └───────────────┘
                 │
        ┌────────▼─────────┐
        │ third-party MCP  │   ← never trusted
        │ servers          │
        └──────────────────┘
```

### One HTTP layer, two hosts

`@mcp-hub/api` owns routing, authentication, authorization, rate limiting and
error mapping, expressed against a framework-agnostic request/response shape.
The Next.js route handler and the standalone `node:http` server are both thin
adapters over the same route table.

The alternative — writing the API twice, once as Next route handlers and once
for self-hosting — guarantees drift. One route table cannot drift from itself.

### Server components use the same path

Dashboard pages resolve a principal exactly the way a REST request does, then
call the same service functions. There is no second, looser route to the
database that exists only because the caller happens to be a React tree. The
browser then performs mutations through `/api/v1`, so every interactive action
is subject to the same checks an API key would face.

## Packages

| Package | Responsibility |
| --- | --- |
| `core` | Prefixed IDs, the `HubError` taxonomy, cursor pagination, the domain model. No I/O. |
| `config` | Environment parsing and validation. Fails at boot, not at first use. |
| `observability` | Structured logging, deep secret redaction, `AsyncLocalStorage` request context. |
| `database` | One PostgreSQL dialect behind two drivers; schema, migrations, repositories. |
| `security` | SSRF guard, AES-256-GCM credential encryption, risk classification, untrusted-content scanning, transport policy, rate limiting, payload limits. |
| `mcp-client` | The MCP protocol client: stdio and Streamable HTTP. |
| `validator` | Rule-based validation of metadata, transports and tool schemas. |
| `versioning` | Schema diffing and change detection with explicit breaking-change rules. |
| `permissions` | Specificity-scored permission evaluation and approval gating. |
| `testing` | Compatibility suites executed against a live server. |
| `search` | `SearchProvider` seam with a PostgreSQL implementation. |
| `analytics` | Time windows, dashboard assembly, evidence-carrying incident detection. |
| `assistant` | Intent → authorised query → evidence → prose, with a pluggable model. |
| `api` | Services and the HTTP layer. |
| `sdk` | The published TypeScript client. |
| `mcp-server` | MCP Hub exposed over MCP, read-only. |
| `ui` | Hook-free presentational components and formatters. |

## The database

PostgreSQL, addressed through a two-driver abstraction:

- **`pg`** against a managed PostgreSQL (Supabase, RDS, self-hosted).
- **PGlite** — PostgreSQL compiled to WebAssembly — running in-process.

Both speak the same dialect, so there is exactly one set of migrations and one
set of queries. This is what makes `pnpm dev` and the whole integration suite
work on a laptop with no services running and no Docker, while the integration
tests still exercise real PostgreSQL semantics: real constraints, real
`FOR UPDATE SKIP LOCKED`, real `tsvector` ranking.

### Tenant isolation

Every organization-owned table carries `organization_id`, and every repository
method takes it and includes it in the `WHERE` clause. Isolation is enforced in
SQL rather than by each caller remembering to filter. Cross-tenant access
returns `NOT_FOUND` rather than `FORBIDDEN`: telling an outsider that a resource
exists is itself a disclosure.

### The job queue

Jobs live in PostgreSQL. Workers claim them with a lease using
`FOR UPDATE SKIP LOCKED`, so several workers can run against one database
without double-processing, and a worker that dies mid-job releases its work when
the lease expires. Recurring work is enqueued by the worker itself with a dedupe
key, so the schedule survives a restart without a separate scheduler.

## The MCP client

MCP Hub implements the client side itself rather than embedding an SDK, because
the properties that matter here live at the transport boundary:

- byte caps on everything read from a server;
- a timeout on every request, so no call can hang a worker;
- redirects refused outright on HTTP transports, since a redirect is the classic
  way to pivot a validated URL onto an internal address;
- a minimal child environment for stdio, so a server never sees the Hub's own
  database URL or encryption key.

Bolting these onto a library's error handling is strictly worse than owning the
~600 lines that need them.

## Data flow: registering and using a server

```
1. Register        metadata is written. Nothing connects.
2. Discover        connect → initialize → list tools/resources/prompts
                   → classify every tool → scan all text for injection
                   → persist → reindex for search
3. Validate        run 22 rules over the stored surface → findings with rules
4. Test            run the compatibility suites against the live server
5. Publish         freeze the surface; diff against the previous version
6. Execute         scope → rules → acknowledgement → approval → limits →
                   transport policy → call → audit → analytics event
7. Monitor         worker health-checks on a schedule → incidents from evidence
```

## What is deliberately not here

- **No separate demo code path.** Demo servers are ordinary rows flagged
  `is_demo`, and every telemetry row generated for them is tagged `demo: true`.
  The dashboard has one rendering path; fictional data is labelled, not special.
- **No LLM in the request path.** The assistant is optional and, by default,
  does not call a model at all.
- **No client-side security.** The UI hides what a role cannot do as a courtesy.
  Every decision is recomputed server-side.

See [security.md](security.md) for the threat model and
[permissions.md](permissions.md) for how a tool call is authorised.

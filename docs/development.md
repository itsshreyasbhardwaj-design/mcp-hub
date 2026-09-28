# Development

## Requirements

Node 22.6+ (24 recommended) and pnpm 11+. That is all — no Docker, no database
server, no accounts.

```bash
git clone https://github.com/itsshreyasbhardwaj-design/mcp-hub.git
cd mcp-hub
pnpm install
cp .env.example .env.local
pnpm build
pnpm db:seed
pnpm dev
```

The dashboard is at http://localhost:3000. Sign in as any seeded user —
`owner@example.com`, `admin@example.com`, `dev@example.com` or
`viewer@example.com` — to see the product from that role.

## Why it needs nothing

With no `DATABASE_URL`, MCP Hub boots PGlite: PostgreSQL compiled to
WebAssembly, running in-process, storing into `.mcp-hub/`. It is real
PostgreSQL, so the same migrations and the same queries run in development,
in tests and in production. Set `DATABASE_URL` to point at a managed database
and nothing else changes.

The same idea applies across the stack: the dev auth provider replaces Clerk,
the database-backed queue replaces Redis, and the grounded assistant replaces a
model API. Each is a real implementation behind an interface, not a stub.

## Layout

```
apps/
  web/        Next.js dashboard and /api/v1/*
  api/        the same API over node:http, for self-hosting without Next
  worker/     health monitoring, indexing, validation, housekeeping
packages/
  core config observability database security mcp-client validator
  versioning permissions testing search analytics assistant api sdk
  mcp-server ui
examples/
  notes-server  a complete MCP server used by the tests
  flaky-server  a deliberately unreliable one, for monitoring and incidents
```

`docs/architecture.md` explains why the boundaries fall where they do.

## Commands

| Command | Does |
| --- | --- |
| `pnpm dev` | Builds packages, then runs the dashboard |
| `pnpm build` | Builds every package and app |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | TypeScript, strict, no emit |
| `pnpm test` | Unit and integration tests |
| `pnpm test:e2e` | Playwright against a real built server |
| `pnpm format` | Prettier |
| `pnpm db:migrate` | Apply pending migrations |
| `pnpm db:seed` | Create the demo organization and servers |
| `pnpm db:reset` | Drop everything, migrate, seed |

Per-package: `pnpm --filter @mcp-hub/security test`.

## Running the worker

```bash
node apps/worker/dist/index.js
```

It claims jobs from the database with a lease, so you can run several. It
enqueues its own recurring work, so health monitoring starts as soon as a
server has an interval configured.

## Running against the example servers

The seed registers `examples/notes-server` and `examples/flaky-server` as real,
runnable servers. After `pnpm build`:

1. Open **Servers → Notes (local example)**.
2. Click **Discover** — it connects over stdio and records five tools.
3. Open **Playground**, run `search_notes`, and see a real MCP round trip.
4. Try `delete_note` and watch the acknowledgement and approval gates fire.

The flaky server is driven by environment variables, so you can make monitoring
react to real failures:

```bash
FLAKY_FAILURE_RATE=0.6 FLAKY_LATENCY_MS=2000 node examples/flaky-server/dist/index.js
```

`FLAKY_HIDE_TOOL` removes a tool from `tools/list`, which is a convenient way to
see version diffing and capability-change incidents.

## Working on a package

Packages compile with `tsc` to `dist`. For a watch loop:

```bash
pnpm --filter @mcp-hub/validator dev
```

`apps/web` has `@mcp-hub/ui` in `transpilePackages`, so UI changes are picked up
by Next directly.

## Conventions

- **Strict TypeScript.** `any` is an ESLint error; the handful of unavoidable
  cases carry a comment saying why.
- **No business logic in route handlers.** They parse, call a service, and
  serialise.
- **Every organization-scoped query takes `organization_id`.** Isolation belongs
  in SQL, not in the caller's memory.
- **Comments explain why.** If a line needs a comment to say what it does, the
  line is usually the problem.
- **Tests assert behaviour, not implementation.** The database suite runs
  against real PostgreSQL; the MCP suite runs against real MCP servers.

## Adding a validation rule

1. Add it to `RULES` in `packages/validator/src/rules.ts` with a stable id.
2. Severity: `error` means a client will break; `warning` means a human or a
   model will be confused.
3. Bump `ruleCatalogueVersion` in `packages/core/src/util.ts`.
4. Add a case to the validator tests.

The id appears in the UI, the API and the SDK, so it is a public contract.

## Adding an API endpoint

1. Add a service function under `packages/api/src/services/`, taking
   `(context, principal, input)` and calling `requireRole` / `requireScope`.
2. Add a zod schema in `http/schemas.ts`.
3. Add the route to `http/routes.ts` with a `summary` — it is published on the
   API page and by `apiRouter.describe()`.
4. Add a typed method to the SDK.
5. Test the authorised path *and* the refusal.

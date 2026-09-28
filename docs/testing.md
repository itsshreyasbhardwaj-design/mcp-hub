# Testing

```bash
pnpm test        # unit and integration
pnpm test:e2e    # Playwright, against a real built server
```

Neither needs a database, a broker or a network. 399 tests run on a laptop with
an empty environment.

## What runs where

| Suite | Count | What it exercises |
| --- | --- | --- |
| `packages/core` | 27 | IDs, slugs, the error taxonomy, cursors, stable hashing |
| `packages/config` | 16 | Boot-time validation and the refusal to run unsafely configured |
| `packages/observability` | 36 | Secret redaction by key and by value shape, log levels, request context |
| `packages/database` | 16 | Real PostgreSQL: constraints, cursors, tenant isolation, job leasing, FTS |
| `packages/security` | 39 | SSRF, crypto, risk classification, injection scanning, limits |
| `packages/mcp-client` | 14 | Real MCP servers over real stdio JSON-RPC |
| `packages/validator` | 29 | Every rule, plus schema inspection and example generation |
| `packages/versioning` | 26 | Schema diffing, rename inference, semver ordering |
| `packages/permissions` | 24 | Rule specificity, the default policy, approval binding |
| `packages/search` | 21 | Ranking strategies, document projection, tsquery safety |
| `packages/analytics` | 23 | Time windows, gap filling, incident detection and resolution |
| `packages/assistant` | 20 | Intent detection, the no-evidence path, model-failure fallback |
| `packages/api` | 54 | The whole lifecycle plus 22 adversarial security tests |
| `packages/sdk` | 24 | Error mapping, retry policy, pagination, timeouts |
| `packages/mcp-server` | 7 | The MCP server binary, driven over stdio |
| `apps/web` (E2E) | 23 | A real browser against a real server |

## The principle: no mocks at the boundary

Mocking the thing you are trying to prove works is how a suite stays green while
the product breaks. So:

- **The database is real.** PGlite is PostgreSQL compiled to WebAssembly, so
  integration tests exercise real constraints, real `FOR UPDATE SKIP LOCKED`,
  real `tsvector` ranking. A migration bug fails a test rather than production.
- **The MCP servers are real.** `examples/notes-server` and
  `examples/flaky-server` are complete MCP implementations. Tests spawn them and
  speak the protocol. The flaky one is configurable by environment variable, so
  timeouts, failures, refusals to start and tool removal are all reproducible.
- **The API is real.** The API suite drives the actual router, so routing,
  authentication, rate limiting and error mapping are all in the path.
- **The browser is real.** E2E builds the app, seeds a throwaway database, and
  drives Chromium against it.

What *is* faked: outbound `fetch` in the SSRF redirect test — the point is the
guard, not the network — and DNS resolution in the address tests, so they assert
on the classification rather than on the internet.

## Security tests

Written from the attacker's side. Each one encodes something the design is meant
to make impossible:

```
tenant isolation      list · read · mutate · delete · discover · publish ·
                      execute · audit · analytics · search
IDOR                  a guessed identifier from another tenant → NOT_FOUND
SSRF                  loopback · RFC1918 · link-local · CGNAT · metadata ·
                      file:// · embedded credentials · internal ports ·
                      public→private redirect
process execution     stdio disabled · command not allowlisted ·
                      shell metacharacters in arguments
escalation            viewer self-promotion · viewer creating keys or rules ·
                      API key exceeding its scopes · removing the last owner
approvals             self-approval · replay after use · different arguments
secrets               never in a response · never in an audit entry ·
                      ciphertext at rest
limits                nesting depth · node count · payload size · body size
injection             detection across descriptions, schemas, resources,
                      prompts; the untrusted fence cannot be forged
```

## Bugs these suites actually caught

Worth recording, because they are the argument for testing this way:

- **A `Date` passed as an untyped parameter** was inferred by PostgreSQL as
  `interval`, so health-check scheduling failed outright. Types could not catch
  it; a smoke test did. There is now a regression test covering elapsed,
  not-elapsed, unscheduled and demo servers.
- **The log redactor matched the bare word `session`**, so a `purgedSessions`
  *count* was being redacted into uselessness.
- **The playground told a viewer "nothing to run yet"** on an undiscovered
  server instead of telling them their role cannot execute tools.
- **`sync_to_remote` classified as `CREDENTIAL`, not `NETWORK`.** The test was
  wrong, not the code: the tool takes an `api_key`, and `CREDENTIAL` outranks
  `NETWORK`. The severity ordering was doing exactly its job.

## Writing a test

Integration tests get a fresh in-memory PostgreSQL:

```ts
import { createTestDatabase } from '@mcp-hub/database';

const db = await createTestDatabase();   // migrated, isolated, in-memory
```

API tests build a context and drive the router directly, so there is no server
to start:

```ts
const app = buildContext(db);
const router = new Router([...authRoutes, ...routes]);
const response = await router.handle(request('GET', '/api/v1/servers'), app);
```

Tests that need a live MCP server spawn one from `examples/`.

## CI

`.github/workflows/ci.yml` runs format, lint, typecheck, unit and integration
tests, a build, and a clean-slate `db:reset` — then E2E in a second job.

`.github/workflows/security.yml` runs a dependency audit, a secret scan over the
history, and the two security suites on their own, so a failure there is
unmissable.

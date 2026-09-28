# Self-hosting

MCP Hub runs three processes. Only the first is required.

| Process | Command | Needed for |
| --- | --- | --- |
| Web | `pnpm --filter @mcp-hub/web start` | The dashboard and the API |
| Worker | `node apps/worker/dist/index.js` | Health monitoring, indexing, housekeeping |
| API only | `node apps/api/dist/index.js` | Serving the API without the dashboard |

The web app already serves `/api/v1`, so `apps/api` is only for deployments that
want the API on its own host.

## Minimum production configuration

```bash
DATABASE_URL=postgresql://user:pass@host:5432/mcp_hub
MCP_HUB_AUTH_PROVIDER=clerk
CLERK_SECRET_KEY=sk_live_...
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_...
MCP_HUB_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
NEXT_PUBLIC_APP_URL=https://hub.example.com
NODE_ENV=production
```

MCP Hub refuses to boot in production without `MCP_HUB_ENCRYPTION_KEY`, and
refuses to use the development auth provider there at all. Both failures happen
at startup, not at the first request that depends on them.

### Keep these off

```bash
MCP_HUB_ALLOW_STDIO=false             # process execution
MCP_HUB_ALLOW_PRIVATE_NETWORK=false   # SSRF surface
```

`MCP_HUB_ALLOW_STDIO=true` lets any user with the developer role cause your
server to execute a local process. It is appropriate for a single-tenant
installation you control, and for nothing else. Even then, keep
`MCP_HUB_STDIO_ALLOWED_COMMANDS` as narrow as possible.

## Database

Any PostgreSQL 14+. Migrations run automatically on boot and are
checksum-verified: an already-applied migration whose contents changed is a hard
error rather than a silent divergence.

To migrate explicitly before a deploy:

```bash
DATABASE_URL=... node scripts/db.ts migrate
```

**Supabase:** put the pooled connection string in `DATABASE_URL` and the direct
one in `DIRECT_URL`. Enable `pg_trgm` for typo-tolerant search; without it the
other three search strategies still work and the UI says which mode is active.

## Deploying to Vercel

The web app is a standard Next.js application.

```
Build command:     pnpm build
Output directory:  apps/web/.next
Install command:   pnpm install
```

Set the environment variables above. Add
`serverExternalPackages` is already configured for `pg`, so no bundler
configuration is needed.

The worker cannot run on Vercel's request-scoped runtime. Run it on any
container host (Fly, Railway, Render, ECS, a VM) with the same `DATABASE_URL`.
Without a worker the product still works — health checks then only run when
someone asks for one.

## Deploying with containers

There is no Dockerfile in the repository, because the build is an ordinary
Node build and pinning a base image here would age badly. The shape is:

```dockerfile
FROM node:24-slim
WORKDIR /app
COPY . .
RUN corepack enable && pnpm install --frozen-lockfile && pnpm build
CMD ["pnpm", "--filter", "@mcp-hub/web", "start"]
```

Run the worker from the same image with
`CMD ["node", "apps/worker/dist/index.js"]`.

## Scaling

- **Web** scales horizontally; it holds no local state beyond the rate-limit
  buckets.
- **Workers** scale horizontally. Jobs are claimed with a database lease using
  `FOR UPDATE SKIP LOCKED`, so several workers never double-process, and a
  worker that dies releases its jobs when the lease expires.
- **Rate limiting** is per-process. Behind several web instances, supply a
  shared store through the `RateLimitStore` interface in `@mcp-hub/security`,
  or enforce limits at the edge.

The schema is indexed for the sizes this product targets — tens of thousands of
servers, hundreds of thousands of tools, millions of events — with cursor
pagination everywhere and no unbounded `SELECT`.

## Health checks

`GET /api/v1/health` is unauthenticated and reports database reachability and
latency. Point your load balancer at it.

## Backups

Everything durable is in PostgreSQL. Back up the database and keep
`MCP_HUB_ENCRYPTION_KEY` somewhere separate — without it, stored credentials
cannot be decrypted, by design.

Rotating the key is not yet automated: re-enter credentials after a rotation.

## Observability

Logs are JSON when `NODE_ENV=production`, one object per line, with
`requestId`, `organizationId`, `route`, `status` and `durationMs`. Secrets are
redacted by key name and by value shape before anything is written.

Ship them anywhere that reads JSON lines. The `requestId` in a log line is the
same one returned in the `X-Request-Id` header and in every error body, so a
user-reported failure is directly findable.

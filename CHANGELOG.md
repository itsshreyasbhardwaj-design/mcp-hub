# Changelog

Notable changes to MCP Hub. This project follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-09-28

The first release: a working control plane for MCP servers.

### Added

**Registry**
- Register servers with metadata, visibility, tags and versions. Registration
  records metadata only — it never connects.
- Capability discovery over real MCP: tools, resources, resource templates and
  prompts, with automatic risk classification and injection scanning.
- Immutable published versions, deprecation, and a recommended version.
- Per-server execution environments and encrypted credential storage.
- Import from Claude Desktop and `mcp.json`, with a preview step that shows
  exactly what would be registered and never executes anything.

**Protocol**
- A hand-written MCP client over stdio and Streamable HTTP, with byte caps,
  per-request timeouts, refused redirects and a minimal child environment.

**Validation and testing**
- 22 validation rules with stable ids over metadata, transports, capability
  consistency and tool schemas.
- 18 compatibility cases run against a live server, all read-only or using
  deliberately invalid input, so a run is safe against production.

**Governance**
- A permission engine resolved by specificity across
  user/role/server/version/tool/risk/environment.
- Approvals bound to a hash of the exact arguments, single-use, expiring sooner
  for more dangerous classes, and never self-approvable.
- An independent sensitive-tool acknowledgement, enforced server-side.
- Risk classification with administrator overrides that retain the original
  verdict, the reviewer and the reason.
- A complete audit log, including refused actions.

**Operations**
- Health monitoring with configurable intervals, and incident detection that
  carries the measurements that opened it and never infers a root cause.
- Version diffing where every change cites the rule that classified it as
  breaking or not.
- Analytics computed entirely from stored events, with gaps rendered as zero.
- A durable PostgreSQL job queue with leases, and a worker that schedules its
  own recurring work.

**Interfaces**
- A dashboard covering overview, servers, discovery, tools, testing,
  monitoring, versions, security, analytics, activity, team, settings and API.
- A REST API with one error envelope, cursor pagination, rate limiting and
  request ids.
- `@mcp-hub/sdk`, typed, with an error hierarchy and retries that never replay
  a tool execution.
- `@mcp-hub/mcp-server`: MCP Hub itself over MCP, read-only by construction.
- An optional assistant that answers only from recorded evidence and, by
  default, calls no model at all.

**Security**
- SSRF guarding with DNS resolution, private/link-local/CGNAT detection, cloud
  metadata blocking, port and scheme denylists, and per-hop redirect
  revalidation.
- AES-256-GCM credential encryption and scrypt-hashed API keys.
- Prompt-injection detection and nonce-fenced containment.
- stdio transports disabled by default and allowlisted when enabled.

### Notes

- Runs from a clean clone with `pnpm install && pnpm dev`: no Docker, no
  database server, no accounts. PGlite provides real PostgreSQL in-process.
- 399 tests, none of which mock the database, the protocol or the browser.

[Unreleased]: https://github.com/itsshreyasbhardwaj-design/mcp-hub/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/itsshreyasbhardwaj-design/mcp-hub/releases/tag/v0.1.0

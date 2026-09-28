# Security model

MCP Hub connects to servers that other people wrote, on endpoints that its own
users supply, and shows the results to a model. Its threat model starts from
the assumption that **every MCP server is hostile**.

## Threat model

| Adversary | What they control | What they want |
| --- | --- | --- |
| A malicious MCP server | Tool names, descriptions, schemas, resource contents, prompts, tool results | To steer an agent, exfiltrate context, or be trusted more than it deserves |
| A user of the Hub | The endpoints they register, the arguments they send | To reach internal infrastructure, or to run something they are not allowed to run |
| A tenant | Their own organization's data | To read or mutate another organization's |
| A compromised credential | One API key or session | To do more than that credential was scoped for |
| A network position | Traffic to third-party endpoints | To redirect a validated URL somewhere else |

## Controls

### Server-side request forgery

Every remote transport is an SSRF primitive unless it is fenced off. The guard
in `@mcp-hub/security/ssrf.ts` is deny-by-default and a URL must clear all of:

- **Scheme** — `http` and `https` only. `file:`, `gopher:` and the rest are refused.
- **Credentials in the URL** — refused outright.
- **Port** — an explicit denylist of internal service ports (22, 3306, 5432, 6379, 9200, 27017, …).
- **Hostname** — cloud metadata hosts (`169.254.169.254`, `metadata.google.internal`, `100.100.100.200`, …) are never reachable, even when private networking is enabled.
- **Resolved address** — DNS is resolved and every returned address is checked against RFC1918, loopback, link-local, CGNAT, multicast and IPv6 unique-local/mapped ranges.
- **Every redirect hop** — redirects are re-validated, or on MCP transports refused entirely. This is what defeats DNS rebinding and redirect pivots.

`MCP_HUB_ALLOW_PRIVATE_NETWORK=true` relaxes the address check for local
development. It does not relax the metadata-host block.

### Process execution

stdio transports launch a local process, which is arbitrary code execution.
Therefore:

- they are **off by default** (`MCP_HUB_ALLOW_STDIO=false`);
- when enabled, the executable must be on `MCP_HUB_STDIO_ALLOWED_COMMANDS`;
- the command and every argument are screened for shell metacharacters, and
  `spawn` is called with `shell: false`;
- the child receives only `PATH`, `HOME` and the variables the server version
  explicitly declared — never the Hub's own environment, so a server can never
  read `DATABASE_URL` or `MCP_HUB_ENCRYPTION_KEY`.

Importing a client configuration file never executes anything: import parses,
previews and waits for confirmation, and flags which entries would launch a
process.

### Prompt injection

Tool descriptions reach a model verbatim, which makes them an injection vector.
MCP Hub does two separate things about it:

1. **Detect and report.** Everything a server sends is scanned for
   instruction-override, role-hijack, exfiltration, tool-coercion, hidden
   characters, encoded blobs, `data:`/`javascript:` URIs and templated markdown
   image links. Matches become security findings and validation findings with
   the offending excerpt rendered with control characters made visible.
2. **Contain.** Any server-provided text entering an LLM context is wrapped in a
   nonce-tagged fence declaring it untrusted data. The nonce is per-call, so the
   content cannot close the block and escape into the instruction channel.

MCP Hub never acts on instructions found in server content. The assistant cannot
execute tools, cannot change permissions, and never reaches the database.

### Credentials

- Stored with AES-256-GCM, random IV per record, key from `MCP_HUB_ENCRYPTION_KEY`.
- Decrypted only inside the execution path, straight into a child environment or
  request headers. No API response contains a decrypted value, and no list
  endpoint selects the ciphertext.
- Generated configuration emits `${PLACEHOLDER}` tokens, so a generated file is
  safe to commit.
- API keys are random 32-byte secrets; only a scrypt hash is stored. The
  plaintext exists once, in the response that created it.
- Logs are deep-redacted by key name and by value shape (OpenAI, Clerk/Stripe,
  GitHub, Slack, JWT, connection strings) before anything is written.
- Production refuses to boot without `MCP_HUB_ENCRYPTION_KEY`.

### Authorization

Four independent gates, all server-side:

1. **Scope** — the credential must carry `tools:execute`.
2. **Role** — viewers cannot execute, regardless of any rule.
3. **Permission rules** — the most specific matching rule wins; with no match,
   sensitive risk classes require approval and the rest are allowed.
4. **Acknowledgement and approval** — sensitive tools need an explicit
   acknowledgement *and*, by default, an approval from a second person that is
   bound to a hash of the exact arguments and usable exactly once.

See [permissions.md](permissions.md) for the resolution algorithm.

### Tenant isolation

`organization_id` is part of every organization-scoped query, in SQL. Requests
for another tenant's resources return `NOT_FOUND`, not `FORBIDDEN`, because
confirming existence is itself a disclosure. An `X-Organization-Id` header the
caller does not belong to is treated the same way.

### Resource limits

- Request bodies capped at 2 MiB at the adapter boundary.
- Tool arguments and MCP responses capped at `MCP_HUB_MAX_PAYLOAD_BYTES`.
- JSON structure capped at 32 levels deep and 50,000 nodes.
- Every outbound request time-bounded by `MCP_HUB_OUTBOUND_TIMEOUT_MS`.
- Fixed-window rate limiting per credential, with a tighter budget for tool
  execution than for reads.

### Auditing

Every meaningful action writes an audit row with the actor, action, resource,
result and request id — including the actions that were **refused**. The
security page surfaces denied calls specifically, because the record of what was
stopped is the part that matters after an incident.

## What is tested

`packages/security` and `packages/api` contain suites written from the
attacker's side rather than the happy path:

- private/loopback/CGNAT/metadata blocking, scheme and port denial, embedded
  credentials, host allowlists, and a redirect from a public URL to a private one;
- AES-GCM round-trip, tamper detection, wrong-key rejection, deterministic API
  key hashing;
- risk classification, including that a server-declared `readOnlyHint` cannot
  downgrade a destructive match;
- injection detection across descriptions, schemas, resources and prompts, and
  that the untrusted fence cannot be forged;
- cross-tenant read, write, delete, discover, publish, execute, audit and search;
- privilege escalation by role and by API-key scope;
- approval replay, approval for different arguments, and self-approval;
- payload depth, node count and size exhaustion;
- that stored credentials never appear in any API response or audit entry.

`pnpm --filter @mcp-hub/security test && pnpm --filter @mcp-hub/api test`

## Reporting a vulnerability

See [SECURITY.md](../SECURITY.md). Please do not open a public issue.

## Known limitations

These are real and deliberately stated rather than hidden:

- **Risk classification is a heuristic.** It reads names, descriptions and
  schemas. A server can name a tool `read_file` and delete the filesystem. It
  exists so reviewers know what to look at first and so the permission engine
  has a defensible default — not as a guarantee. Administrators can override any
  classification; the original verdict, the override, its author and its reason
  are all retained.
- **Injection detection is pattern-based.** It will miss novel phrasings. The
  containment control (fencing, and never executing server-provided
  instructions) is the one that does not depend on detection succeeding.
- **Rate limiting is per-process.** The in-memory limiter is correct for a
  single node. Multi-instance deployments should supply a shared store through
  the `RateLimitStore` interface.
- **The dev auth provider has no password.** It exists to switch between seeded
  roles locally. Config refuses to construct it under `NODE_ENV=production`, and
  the provider itself refuses too.

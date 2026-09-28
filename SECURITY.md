# Security policy

## Reporting a vulnerability

Please report privately through
[GitHub Security Advisories](https://github.com/itsshreyasbhardwaj-design/mcp-hub/security/advisories/new).

Do not open a public issue.

Include what you can:

- what an attacker can do, and what they need to start;
- the steps to reproduce it;
- the affected version or commit;
- any request id from an `X-Request-Id` header, if one is involved.

You will get an acknowledgement within 72 hours and an assessment within a week.
If a fix is needed, you will be credited in the advisory unless you ask not to
be.

## Supported versions

MCP Hub is pre-1.0. Fixes land on `main`.

## Scope

In scope, and taken seriously:

- authentication or authorisation bypass;
- cross-tenant data access of any kind;
- SSRF past the outbound guard;
- credential disclosure, in an API response, a log line or an audit entry;
- executing a tool without the permission, acknowledgement and approval gates;
- prompt injection that causes MCP Hub itself to take an action, rather than
  merely being displayed;
- remote code execution, including through the stdio transport allowlist.

Out of scope:

- anything that requires `MCP_HUB_ALLOW_STDIO=true`, which is documented as
  arbitrary code execution and is off by default;
- anything that requires `MCP_HUB_ALLOW_PRIVATE_NETWORK=true`, which is
  documented as disabling part of the SSRF guard for local development;
- the development auth provider, which has no password by design and refuses to
  run under `NODE_ENV=production`;
- a malicious MCP server returning misleading *content* — MCP Hub displays it,
  labels it untrusted and never acts on it, which is the intended behaviour;
- risk misclassification. Classification is a documented heuristic, not a
  guarantee. A tool that does more than its name suggests is exactly why
  approvals exist.

## Design notes

The controls, and what they do and do not cover, are in
[docs/security.md](docs/security.md), including a **Known limitations**
section that states the parts that are weaker than they might look.

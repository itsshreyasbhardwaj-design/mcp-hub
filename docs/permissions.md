# Permissions, risk and approvals

How MCP Hub decides whether a tool call may happen.

## The pipeline

Every execution — from the playground, the REST API or the SDK — goes through
`executeTool` in `@mcp-hub/api`, in this order:

```
1. Scope            the credential carries tools:execute
2. Role             viewers cannot execute, ever
3. Permission rules the most specific match wins
4. Acknowledgement  sensitive tools need an explicit confirmation
5. Approval         bound to a hash of these exact arguments, single-use
6. Payload limits   size, depth and node count
7. Transport policy SSRF and stdio allowlist
8. Execute          then audit, and record an analytics event
```

A refusal at any step is recorded as an invocation with status `denied` or
`blocked`, audited with the reason, and surfaced on the Security page. The
record of what was stopped is as important as the record of what ran.

## Risk classification

Tools are classified into seven classes, ordered by severity:

| Class | Meaning | Default |
| --- | --- | --- |
| `ADMIN` | Changes permissions, roles or accounts | Requires approval |
| `DESTRUCTIVE` | Can destroy data irreversibly, or execute code | Requires approval |
| `CREDENTIAL` | Handles secrets, keys or authentication | Requires approval |
| `NETWORK` | Makes outbound requests | Allowed |
| `WRITE` | Creates or modifies data | Allowed |
| `READ` | Reads data | Allowed |
| `UNKNOWN` | No signal matched | Requires approval |

### How it is decided

Rules match against the tool name, its description and its input schema. Each
rule contributes a weight to its class; the **most severe class with a
meaningful score wins**, because under-classifying is the dangerous failure.

MCP tool annotations adjust rather than decide. A server declaring
`readOnlyHint: true` on a tool named `delete_everything` still gets
`DESTRUCTIVE` — the server is not a trusted source of its own safety claims.

`UNKNOWN` is deliberate. When nothing matches, MCP Hub says so and treats the
tool as sensitive, instead of guessing `READ` and being wrong quietly. Every
unclassifiable tool also raises a `risk.unclassified` security finding.

### This is a heuristic

Stated plainly in the product and in the API: classification reads text, and
text can lie. It exists to give reviewers a starting point and the permission
engine a defensible default.

Any administrator can override a classification. The override stores the
original heuristic verdict, the new class, the reviewer and their reason — so
the decision is auditable, and so a wrong override is visible as a decision
someone made rather than as a fact about the tool.

## Permission rules

A rule targets any combination of: user, role, server, version, tool name
(with a trailing wildcard), risk class and environment. Its effect is `allow`,
`require_approval` or `deny`.

### Resolution

Rules are scored by **specificity**, not by list order:

| Dimension | Weight |
| --- | --- |
| Specific user | 16 |
| Exact tool name | 16 |
| Tool-name wildcard | 8 |
| Specific version | 8 |
| Specific server | 4 |
| Specific role | 4 |
| Specific environment | 4 |
| Risk class | 2 |

The highest score wins. Ties break on explicit `priority`, then on effect
severity (`deny` > `require_approval` > `allow`), so a tie never silently
resolves in the permissive direction.

Specificity rather than order means a rule's meaning does not change because
someone inserted another rule above it.

### The default policy

With no matching rule:

- sensitive classes (`DESTRUCTIVE`, `CREDENTIAL`, `ADMIN`, `UNKNOWN`) require approval;
- everything else is allowed for developers and above.

### Example

```
deny             role: viewer      any tool        priority 100
require_approval anyone            DESTRUCTIVE     priority 50
allow            role: developer   READ            priority 10
allow            user: ci-bot      github.search_* priority 0
```

For a developer calling `delete_branch` (DESTRUCTIVE): the viewer rule does not
match, the READ rule does not match, and the DESTRUCTIVE rule does — so the call
requires approval.

## Approvals

An approval authorises **one execution of one tool with one exact argument
payload**.

- The request stores the arguments verbatim and a SHA-256 of their
  key-sorted serialisation. Argument order cannot be used to evade the hash.
- Executing with different arguments than were approved is refused, even with a
  valid approval id.
- An approval is consumed on use — successful or not. A failed destructive call
  must not leave a reusable grant behind.
- Approvals expire, and sooner for more dangerous classes: 15 minutes for
  `DESTRUCTIVE` and `ADMIN`, 30 for `CREDENTIAL`, an hour otherwise.
- **A requester cannot approve their own request.** Two people, always.

## The sensitive-tool acknowledgement

Independent of approval. Even when a rule allows a destructive tool outright,
the caller must send `acknowledgeRisk: true`.

This is a second gate, not a UI nicety: the flag is checked server-side, so
unticking the box in the browser is not what prevents the call. The playground
says so on the checkbox itself, because a control that appears to be the
security boundary but is not is worse than no control.

## Roles

| Role | Can |
| --- | --- |
| `owner` | Everything, including transferring ownership |
| `admin` | Manage members, permission rules, API keys, approvals and risk overrides |
| `developer` | Register servers, run discovery, validation and tests, execute permitted tools |
| `viewer` | Read only. Cannot execute tools under any rule |

Roles are the floor, not the ceiling. A rule can narrow what a developer may
run; no rule can let a viewer execute.

## API key scopes

Keys carry explicit scopes rather than inheriting a role:

`servers:read` · `servers:write` · `tools:read` · `tools:execute` ·
`validation:run` · `testing:run` · `health:read` · `analytics:read` ·
`audit:read` · `admin`

A key without `tools:execute` cannot run a tool no matter what the permission
rules say — the scope check runs first. This is what makes a read-only key safe
to hand to an agent.

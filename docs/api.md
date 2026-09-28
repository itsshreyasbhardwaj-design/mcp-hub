# REST API

Base path `/api/v1`. All requests and responses are JSON.

## Authentication

Either an API key or a browser session.

```http
Authorization: Bearer mch_...
```

API keys are created under **Settings → API**, carry explicit scopes, and are
bound to one organization. The plaintext is shown once and never recoverable.

When a user belongs to several organizations, select one with:

```http
X-Organization-Id: org_...
```

## Errors

Every non-2xx response uses one envelope:

```json
{
  "error": {
    "code": "SERVER_NOT_FOUND",
    "message": "The requested MCP server does not exist.",
    "requestId": "req_9f1c2d3e4a5b6c7d8e9f0a1b"
  }
}
```

Switch on `error.code`, never on the message. Codes are stable:

`BAD_REQUEST` `VALIDATION_FAILED` `UNAUTHENTICATED` `FORBIDDEN` `NOT_FOUND`
`SERVER_NOT_FOUND` `VERSION_NOT_FOUND` `TOOL_NOT_FOUND` `CONFLICT`
`VERSION_IMMUTABLE` `SLUG_TAKEN` `RATE_LIMITED` `PAYLOAD_TOO_LARGE`
`APPROVAL_REQUIRED` `PERMISSION_DENIED` `TRANSPORT_BLOCKED` `UPSTREAM_ERROR`
`UPSTREAM_TIMEOUT` `NOT_IMPLEMENTED` `INTERNAL`

Validation failures add `details.issues[]` with a `path` and `message` per
field. Unexpected failures are reported as `INTERNAL` with the stack kept
server-side.

Every response carries `X-Request-Id`, repeated in the error body, and appears
in the structured logs for that request.

## Pagination

List endpoints take `limit` (default 25, max 100) and an opaque `cursor`:

```json
{ "data": [...], "nextCursor": "MjAyNi0wOS0yOFQxMjowMDowMFp8c3J2XzEyMw", "total": 137 }
```

Cursors encode a sort value and an id, so pages stay stable under concurrent
inserts. Keep requesting until `nextCursor` is `null`.

## Rate limits

Fixed window per credential. Reads and writes share one budget; tool execution,
discovery and compatibility runs share a tighter one. Exceeding either returns
`429` with `details.resetAt`.

## Endpoints

### Meta

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/health` | Unauthenticated liveness and readiness probe |
| `GET` | `/meta/rules` | The validation rule catalogue |
| `GET` | `/meta/suites` | The compatibility case catalogue |

### Servers

| Method | Path | Scope |
| --- | --- | --- |
| `GET` | `/servers` | `servers:read` |
| `POST` | `/servers` | `servers:write` |
| `GET` | `/servers/:server` | `servers:read` |
| `PATCH` | `/servers/:server` | `servers:write` |
| `DELETE` | `/servers/:server` | admin |
| `GET` | `/servers/:server/tools` | `tools:read` |
| `GET` | `/servers/:server/versions` | `servers:read` |
| `POST` | `/servers/:server/versions` | `servers:write` |
| `POST` | `/servers/:server/validate` | `validation:run` |
| `POST` | `/servers/:server/test` | `testing:run` |
| `POST` | `/servers/:server/health-check` | `health:read` |
| `GET` | `/servers/:server/health` | `health:read` |
| `GET` | `/servers/:server/analytics` | `analytics:read` |
| `GET` | `/servers/:server/security` | `servers:read` |
| `GET` | `/servers/:server/environments` | `servers:read` |
| `POST` | `/servers/:server/environments` | developer |
| `PUT` | `/servers/:server/secrets` | admin |
| `POST` | `/servers/:server/config` | `servers:read` |

`:server` accepts an id or a slug.

### Versions

| Method | Path |
| --- | --- |
| `POST` | `/versions/:version/discover` |
| `POST` | `/versions/:version/publish` |
| `PATCH` | `/versions/:version` |
| `GET` | `/versions/:version/compare/:other` |

### Tools

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/tools` | Search across every server |
| `POST` | `/tools/preview` | What the permission engine would decide |
| `POST` | `/tools/execute` | Executes through every gate |
| `POST` | `/tools/:tool/risk` | Override a classification (admin) |

`/tools/execute` returns `403` when denied or refused for want of an approval,
and `428` when the sensitive-tool acknowledgement is missing.

### Governance

| Method | Path |
| --- | --- |
| `GET` `POST` | `/approvals` |
| `POST` | `/approvals/:approval/decision` |
| `GET` `POST` | `/permissions` |
| `DELETE` | `/permissions/:rule` |
| `GET` | `/incidents` |
| `POST` | `/incidents/:incident/resolve` |
| `GET` | `/activity` |
| `GET` | `/invocations` |
| `GET` | `/analytics` |
| `GET` | `/search`, `/search/suggest` |

### Organization

| Method | Path |
| --- | --- |
| `GET` | `/team` |
| `POST` | `/team/members` |
| `PATCH` `DELETE` | `/team/members/:user` |
| `POST` | `/team/teams` |
| `GET` `POST` | `/api-keys` |
| `POST` | `/api-keys/:key/rotate` |
| `DELETE` | `/api-keys/:key` |
| `POST` | `/import/preview`, `/import/confirm` |
| `POST` | `/assistant` |

## Examples

Register and discover:

```bash
curl -X POST "$HUB/api/v1/servers" \
  -H "authorization: Bearer $MCP_HUB_API_KEY" \
  -H 'content-type: application/json' \
  -d '{
    "name": "GitHub",
    "slug": "github",
    "version": {
      "version": "1.0.0",
      "transport": {
        "kind": "streamable-http",
        "url": "https://mcp.example.com/mcp",
        "headerKeys": ["Authorization"]
      }
    }
  }'

curl -X POST "$HUB/api/v1/versions/$VERSION_ID/discover" \
  -H "authorization: Bearer $MCP_HUB_API_KEY" -d '{}'
```

Check before executing:

```bash
curl -X POST "$HUB/api/v1/tools/preview" \
  -H "authorization: Bearer $MCP_HUB_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"versionId":"'$VERSION_ID'","toolName":"delete_branch"}'
```

```json
{
  "riskClass": "DESTRUCTIVE",
  "decision": {
    "effect": "require_approval",
    "reason": "Destructive tools always require a second person to approve.",
    "source": "rule"
  },
  "requiresAcknowledgement": true
}
```

The live route table, with a description for each endpoint, is on the **API**
page of the dashboard and from `apiRouter.describe()`.

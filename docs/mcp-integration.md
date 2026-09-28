# MCP integration

MCP Hub is itself an MCP server, so an agent can ask the registry what exists
before it decides what to call.

## Setup

```json
{
  "mcpServers": {
    "mcp-hub": {
      "command": "npx",
      "args": ["-y", "@mcp-hub/mcp-server"],
      "env": {
        "MCP_HUB_API_KEY": "${MCP_HUB_API_KEY}",
        "MCP_HUB_URL": "https://hub.example.com"
      }
    }
  }
}
```

| Variable | Required | Notes |
| --- | --- | --- |
| `MCP_HUB_API_KEY` | yes | Use a read-only key |
| `MCP_HUB_URL` | no | Defaults to `http://localhost:3000` |
| `MCP_HUB_ORGANIZATION_ID` | no | When the key spans several organizations |

## Tools

All eight are read-only and annotated `readOnlyHint`.

| Tool | Returns |
| --- | --- |
| `search_servers` | Registry entries matching a query |
| `get_server` | One server with its recommended version and capability counts |
| `list_tools` | Every tool of a server version, with risk classifications |
| `get_tool_schema` | The full JSON Schema for one tool |
| `search_tools` | Tools across every server, filterable by risk |
| `validate_server` | The latest validation findings |
| `get_server_health` | Uptime, latency and open incidents with their evidence |
| `get_version_changes` | A structured diff, with each change's breaking-change rule |

## What it deliberately cannot do

There is **no** `execute_tool`, `register_server`, `delete_server`,
`approve_request` or `set_permission`. The server exposes no write path at all.

This is structural, not configuration. An agent that reads a hostile tool
description cannot be talked into registering a server or running something,
because the capability is not present in the session.

Two further bounds apply:

1. The server authenticates with an ordinary API key, so it can never see more
   than that key's scopes and organization allow.
2. Risk classifications it reports are described as MCP Hub's heuristic, not as
   guarantees, so an agent is not encouraged to treat `READ` as proof of safety.

Administrative actions stay in the authenticated UI and the REST API, where a
human is accountable for them.

## Example session

```
→ search_tools { "query": "issue", "risk": ["WRITE"] }
← github.create_issue    (WRITE)   Creates a new issue.
  linear.create_issue    (WRITE)   Creates an issue in a team.

→ get_tool_schema { "server": "github", "tool": "create_issue" }
← { "inputSchema": { "type": "object",
      "properties": { "repository": {...}, "title": {...} },
      "required": ["repository", "title"] },
    "riskClass": "WRITE" }

→ get_server_health { "server": "github", "range": "24h" }
← { "summary": { "uptimePercent": 99.2, "p95LatencyMs": 410 },
    "openIncidents": [] }
```

The agent now knows the tool exists, what arguments it takes, how risky MCP Hub
considers it, and whether the server is currently healthy — before attempting
anything.

## Running it directly

```bash
MCP_HUB_API_KEY=mch_... MCP_HUB_URL=https://hub.example.com \
  node packages/mcp-server/dist/bin.js
```

It speaks MCP over stdio on stdin/stdout, so any MCP client can drive it.

# Search

Search has to answer two different questions:

- "which server does X?" — the registry
- "which of my servers can create an issue?" — the tool explorer

Both run through one provider.

## Strategies

Four run in a single statement, and the best score per document wins:

| Strategy | How | Weight |
| --- | --- | --- |
| Exact | `lower(title) = lower(query)` | 1.0 |
| Prefix | `lower(title) LIKE 'query%'` | 0.75 |
| Full text | `ts_rank` over a weighted `tsvector` | rank × 2.0 |
| Fuzzy | `similarity()` from `pg_trgm`, threshold 0.3 | similarity × 0.6 |

Every result reports which strategy matched it, so a surprising ordering is
explainable rather than mysterious.

### Weighting

The indexed `tsvector` weights title (A) and subtitle/tags (B) above body (C),
so a server named "Postgres" outranks one that merely mentions postgres in its
description.

### When pg_trgm is unavailable

Fuzzy matching is skipped and the other three still work. The provider reports
its capability, the Discover page says so explicitly, and the Settings page
shows whether it is active. Silently returning worse results would be worse than
saying so.

## What is indexed

The index is a projection of the registry, rebuilt from current rows whenever a
server or its capabilities change — never patched incrementally, because a stale
index is a silent failure.

| Document | Title | Body |
| --- | --- | --- |
| Server | Name | Description, slug, maintainer, license |
| Tool | Tool name | Description, schema property names, server name |
| Resource | Name or URI | Description, URI, MIME type |
| Prompt | Prompt name | Description, argument names |

Indexing tool *schema property names* is what makes "repository title" find
`create_issue`.

## Scoping

A query returns documents belonging to the caller's organization, plus servers
marked `public` from any organization when `includePublic` is set. Private and
organization-scoped documents from other tenants are unreachable, and there is a
test that asserts exactly that.

## The provider seam

```ts
interface SearchProvider {
  searchServers(query: SearchQuery): Promise<Page<SearchResult>>;
  searchTools(query: SearchQuery): Promise<Page<SearchResult>>;
  searchAll(query: SearchQuery): Promise<Page<SearchResult>>;
  suggest(organizationId, prefix, limit): Promise<string[]>;
  index(documents: readonly IndexDocument[]): Promise<void>;
  removeServer(serverId): Promise<void>;
  removeVersion(versionId): Promise<void>;
}
```

PostgreSQL is the shipped implementation and is sufficient well past the
registry sizes this product targets. The interface exists so a deployment could
move to a dedicated engine without touching calling code — not because a second
engine is planned. Adding vector search would be easy and, for a registry of
this size, would mostly add operational surface; `pgvector` is available in the
same database if a workload ever justifies it.

## Injection safety

User input never reaches SQL as text. `to_tsquery` input is built by stripping
each term to word characters and joining with `&`, with the final term made a
prefix match. `LIKE` patterns escape `\`, `%` and `_`. Everything else is a
bound parameter.

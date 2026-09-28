# Contributing

Thanks for considering it. This is a small project with strong opinions, so it
helps to know them before you spend an evening on a patch.

## Getting set up

```bash
pnpm install
pnpm build
pnpm db:seed
pnpm dev
```

No Docker, no database server, no accounts. If any of that is not true for you,
that is a bug worth reporting on its own.

See [docs/development.md](docs/development.md) for the layout and the commands.

## Before opening a pull request

```bash
pnpm format
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e   # if the change is user-visible
```

CI runs all of it, plus a dependency audit and a secret scan.

## What gets merged easily

- A failing test that demonstrates a bug, with the fix.
- A new validation rule, with its id, its severity rationale and a test.
- A new compatibility case that is read-only or uses deliberately invalid input.
- Documentation that corrects something the code actually does differently.
- Accessibility fixes.

## What needs a conversation first

Open an issue before building:

- anything that changes the authorisation pipeline or adds a way to execute a tool;
- anything that adds a required external service;
- a new package, or moving a boundary between existing ones;
- anything that makes `pnpm dev` need more than `pnpm install`.

The last one matters more than it sounds. Being runnable from a clean clone with
no services is a feature, and it is easy to lose one dependency at a time.

## House rules

**Strict TypeScript.** `any` is an ESLint error. The few unavoidable cases carry
a comment explaining why.

**No business logic in route handlers.** They parse input, call a service, and
serialise the result.

**Every organization-scoped query takes `organization_id`,** and includes it in
the `WHERE` clause. Isolation lives in SQL, not in the caller remembering.

**Server content is untrusted.** Tool descriptions, schemas, resource contents
and results are attacker-controlled. Never place them somewhere they can act as
instructions, and never log them unredacted.

**Comments explain why, not what.** If a line needs a comment to say what it
does, rewrite the line.

**Never fabricate a number.** Every metric in the product is an aggregate over
stored events. If there is no data, the UI says so. A plausible-looking chart
with no data behind it is worse than an empty state.

**Tests assert behaviour.** The database tests run against real PostgreSQL and
the MCP tests against real MCP servers, because mocking the thing you are trying
to prove works is how a suite stays green while the product breaks.

## Commits

Conventional-ish prefixes (`feat:`, `fix:`, `docs:`, `test:`, `refactor:`,
`chore:`). Explain *why* in the body when it is not obvious — the subject line
can usually be reconstructed from the diff, but the reasoning cannot.

## Security

Do not open a public issue for a vulnerability. See [SECURITY.md](SECURITY.md).

## Code of conduct

Participation is governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

import type { Metadata } from 'next';
import Link from 'next/link';
import { FlaskConical } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  DataTable,
  EmptyState,
  MetricCard,
  Note,
  PageHeader,
  formatDuration,
  formatRelative,
} from '@mcp-hub/ui';
import { suiteCatalogue } from '@mcp-hub/testing';
import { ruleCatalogue } from '@mcp-hub/validator';
import { requireSession } from '@/lib/session';
import { RunTestsPanel } from '@/components/testing/run-tests-panel';
import { CompatibilityRunDetail } from '@/components/testing/compatibility-run-detail';

export const metadata: Metadata = { title: 'Testing' };
export const dynamic = 'force-dynamic';

export default async function TestingPage({
  searchParams,
}: {
  searchParams: Promise<{ run?: string }>;
}) {
  const { run: runId } = await searchParams;
  const session = await requireSession();

  const [runs, validations, servers, selected] = await Promise.all([
    session.app.repositories.governance.listCompatibilityRuns(
      session.principal.organizationId,
      null,
      25,
    ),
    session.app.repositories.governance.listValidationRuns(
      session.principal.organizationId,
      null,
      25,
    ),
    session.app.repositories.registry
      .listServers(session.principal.organizationId, { includeDemo: false }, { limit: 100 })
      .then((page) => page.data),
    runId
      ? session.app.repositories.governance.findCompatibilityRun(
          session.principal.organizationId,
          runId as never,
        )
      : Promise.resolve(null),
  ]);

  const serverNames = new Map(servers.map((server) => [server.id, server.slug]));
  const lastRun = runs[0];

  const runnable = await Promise.all(
    servers.map(async (server) => {
      const versions = await session.app.repositories.registry.listVersions(
        session.principal.organizationId,
        server.id,
      );
      return {
        id: server.id,
        slug: server.slug,
        name: server.name,
        versions: versions.map((version) => ({ id: version.id, version: version.version })),
      };
    }),
  );

  return (
    <>
      <PageHeader
        title="Testing"
        description="Compatibility suites run against a live server; validation runs against stored metadata. Both record every case so results can be re-read later."
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Compatibility runs" value={runs.length} hint="most recent 25" />
        <MetricCard
          label="Last run"
          value={lastRun ? `${lastRun.passed}/${lastRun.total}` : '—'}
          tone={lastRun && lastRun.failed > 0 ? 'danger' : 'default'}
          hint={
            lastRun
              ? `${formatRelative(lastRun.createdAt)} · ${formatDuration(lastRun.durationMs)}`
              : 'never run'
          }
        />
        <MetricCard label="Validation runs" value={validations.length} hint="most recent 25" />
        <MetricCard
          label="Rules / cases"
          value={`${ruleCatalogue().length} / ${suiteCatalogue().length}`}
          hint="validation rules and compatibility cases"
        />
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <RunTestsPanel
            servers={runnable.filter((server) => server.versions.length > 0)}
            suites={suiteCatalogue()}
          />
        </div>

        <div className="space-y-3 lg:col-span-2">
          {selected ? (
            <CompatibilityRunDetail
              run={{
                id: selected.id,
                total: selected.total,
                passed: selected.passed,
                warnings: selected.warnings,
                failed: selected.failed,
                skipped: selected.skipped,
                durationMs: selected.durationMs,
                createdAt: selected.createdAt.toISOString(),
                serverSlug: serverNames.get(selected.serverId) ?? selected.serverId,
                cases: selected.cases.map((testCase) => ({
                  id: testCase.id,
                  suite: testCase.suite,
                  key: testCase.key,
                  title: testCase.title,
                  outcome: testCase.outcome,
                  durationMs: testCase.durationMs,
                  message: testCase.message,
                  evidence: testCase.evidence,
                })),
              }}
            />
          ) : null}

          <Card>
            <CardHeader title="Compatibility runs" />
            <DataTable
              caption="Compatibility runs"
              rows={runs}
              rowKey={(run) => run.id}
              empty={
                <EmptyState
                  className="border-0"
                  icon={<FlaskConical className="size-8" />}
                  title="No compatibility runs yet"
                  description="Pick a server on the left and run the suites. Every case is read-only or deliberately invalid, so a run is safe against production."
                />
              }
              columns={[
                {
                  key: 'server',
                  header: 'Server',
                  render: (run) => (
                    <Link
                      href={`/testing?run=${run.id}`}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {serverNames.get(run.serverId) ?? run.serverId}
                    </Link>
                  ),
                },
                {
                  key: 'result',
                  header: 'Result',
                  render: (run) => (
                    <span className="flex flex-wrap gap-1">
                      <Badge tone="success">{run.passed} passed</Badge>
                      {run.warnings > 0 ? <Badge tone="warning">{run.warnings} warn</Badge> : null}
                      {run.failed > 0 ? <Badge tone="danger">{run.failed} failed</Badge> : null}
                      {run.skipped > 0 ? <Badge tone="muted">{run.skipped} skipped</Badge> : null}
                    </span>
                  ),
                },
                {
                  key: 'duration',
                  header: 'Duration',
                  align: 'right',
                  width: '100px',
                  render: (run) => (
                    <span className="text-xs text-fg-4">{formatDuration(run.durationMs)}</span>
                  ),
                },
                {
                  key: 'when',
                  header: 'When',
                  align: 'right',
                  width: '130px',
                  render: (run) => (
                    <span className="text-xs text-fg-4">{formatRelative(run.createdAt)}</span>
                  ),
                },
              ]}
            />
          </Card>

          <Card>
            <CardHeader title="Validation runs" />
            <DataTable
              caption="Validation runs"
              rows={validations}
              rowKey={(run) => run.id}
              empty={
                <div className="px-4 py-8">
                  <Note>No validation runs recorded yet.</Note>
                </div>
              }
              columns={[
                {
                  key: 'server',
                  header: 'Server',
                  render: (run) => (
                    <Link
                      href={`/servers/${serverNames.get(run.serverId) ?? run.serverId}?tab=security`}
                      className="font-mono text-xs text-accent hover:underline"
                    >
                      {serverNames.get(run.serverId) ?? run.serverId}
                    </Link>
                  ),
                },
                {
                  key: 'outcome',
                  header: 'Outcome',
                  width: '110px',
                  render: (run) => (
                    <Badge
                      tone={
                        run.outcome === 'pass'
                          ? 'success'
                          : run.outcome === 'warning'
                            ? 'warning'
                            : 'danger'
                      }
                    >
                      {run.outcome}
                    </Badge>
                  ),
                },
                {
                  key: 'counts',
                  header: 'Findings',
                  render: (run) => (
                    <span className="text-xs text-fg-3">
                      {run.errorCount} error(s), {run.warningCount} warning(s), {run.infoCount}{' '}
                      note(s)
                    </span>
                  ),
                },
                {
                  key: 'when',
                  header: 'When',
                  align: 'right',
                  width: '130px',
                  render: (run) => (
                    <span className="text-xs text-fg-4">{formatRelative(run.createdAt)}</span>
                  ),
                },
              ]}
            />
          </Card>
        </div>
      </div>
    </>
  );
}

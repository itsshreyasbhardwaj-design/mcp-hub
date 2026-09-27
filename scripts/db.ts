#!/usr/bin/env node
/**
 * Database CLI.
 *
 *   pnpm db:migrate   apply pending migrations
 *   pnpm db:seed      create the demo organization, users and servers
 *   pnpm db:reset     drop everything, migrate, then seed
 *
 * With no DATABASE_URL this operates on the embedded PostgreSQL under
 * MCP_HUB_DATA_DIR, so it works on a laptop with no services running.
 */
import { connect, dropAll, runMigrations } from '@mcp-hub/database';
import { buildContext, seed } from '@mcp-hub/api';
import { getConfig } from '@mcp-hub/config';

const command = process.argv[2] ?? 'migrate';

async function main(): Promise<void> {
  const config = getConfig();
  const driver = await connect({ migrate: false });
  console.log(`→ database: ${driver.kind}${driver.kind === 'pglite' ? ` (${config.database.embeddedPath})` : ''}`);

  try {
    if (command === 'reset') {
      await dropAll(driver);
      console.log('✔ dropped every table');
    }

    if (command === 'migrate' || command === 'reset') {
      const result = await runMigrations(driver);
      console.log(
        result.applied.length > 0
          ? `✔ applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`
          : '✔ schema already up to date',
      );
    }

    if (command === 'seed' || command === 'reset') {
      await runMigrations(driver);
      const context = buildContext(driver, config);
      const result = await seed(context);
      console.log('✔ seeded demo data');
      console.log(`  organization : ${result.organizationId}`);
      console.log(`  demo servers : ${result.demoServers} (clearly labelled DEMO DATA)`);
      console.log(`  local servers: ${result.localServers} (real, runnable from examples/)`);
      console.log(`  demo events  : ${result.events}`);
      console.log('  sign in as   :');
      for (const user of result.users) console.log(`    ${user.email.padEnd(22)} ${user.role}`);
    }

    if (!['migrate', 'seed', 'reset'].includes(command)) {
      console.error(`Unknown command "${command}". Use migrate, seed or reset.`);
      process.exitCode = 1;
    }
  } finally {
    await driver.close();
  }
}

main().catch((err: unknown) => {
  console.error('✖', err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

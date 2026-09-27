import { basename } from 'node:path';
import { type TransportConfig, HubError } from '@mcp-hub/core';
import { assertUrlAllowed, type SsrfPolicy } from './ssrf.js';

export interface TransportPolicy {
  allowStdio: boolean;
  stdioAllowedCommands: readonly string[];
  ssrf: SsrfPolicy;
}

/** Shell metacharacters that must never appear in a command or argument. */
const SHELL_METACHARACTERS = /[;&|`$(){}<>\n\r]/;

/**
 * Validates a transport before anything connects through it.
 *
 * stdio transports are process execution, so they are refused outright unless
 * the deployment explicitly opts in and the executable is on an allowlist.
 * Arguments are passed to `spawn` without a shell, and are additionally
 * screened here so a metacharacter never reaches an execution path by accident.
 */
export async function assertTransportAllowed(
  transport: TransportConfig,
  policy: TransportPolicy,
): Promise<void> {
  if (transport.kind === 'stdio') {
    if (!policy.allowStdio) {
      throw new HubError(
        'TRANSPORT_BLOCKED',
        'stdio transports launch local processes and are disabled. ' +
          'Set MCP_HUB_ALLOW_STDIO=true only on a trusted single-tenant installation.',
      );
    }
    const command = transport.command.trim();
    if (!command) throw new HubError('TRANSPORT_BLOCKED', 'A stdio transport needs a command.');
    if (SHELL_METACHARACTERS.test(command)) {
      throw new HubError('TRANSPORT_BLOCKED', 'The command contains shell metacharacters.');
    }
    const executable = basename(command);
    if (!policy.stdioAllowedCommands.includes(executable)) {
      throw new HubError(
        'TRANSPORT_BLOCKED',
        `Executable "${executable}" is not in MCP_HUB_STDIO_ALLOWED_COMMANDS.`,
        { details: { allowed: policy.stdioAllowedCommands } },
      );
    }
    for (const arg of transport.args) {
      if (SHELL_METACHARACTERS.test(arg)) {
        throw new HubError('TRANSPORT_BLOCKED', 'A command argument contains shell metacharacters.', {
          details: { arg },
        });
      }
    }
    return;
  }

  await assertUrlAllowed(transport.url, policy.ssrf);
}

/** Summarises a transport for display without leaking credential values. */
export function describeTransport(transport: TransportConfig): string {
  if (transport.kind === 'stdio') {
    return `stdio: ${transport.command} ${transport.args.join(' ')}`.trim();
  }
  const url = new URL(transport.url);
  return `${transport.kind}: ${url.origin}${url.pathname}`;
}

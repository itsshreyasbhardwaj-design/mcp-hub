import { describe, expect, it } from 'vitest';
import { REDACTED, isSecretKey, redact, redactString } from '../redact.js';
import { createLogger } from '../logger.js';
import { currentRequestId, newRequestId, runWithContext } from '../context.js';

/**
 * Credential-shaped fixtures are assembled at runtime rather than written as
 * literals. They are entirely synthetic, but a literal that matches a real key
 * format trips secret scanners on every push — and a test suite should not
 * teach people to commit things that look like keys.
 */
const FAKE = {
  openai: ['sk', 'A'.repeat(28)].join('-'),
  stripe: ['sk', 'live', 'A'.repeat(28)].join('_'),
  github: ['ghp', 'A'.repeat(36)].join('_'),
  slack: ['xoxb', '1234567890', 'A'.repeat(16)].join('-'),
  postgres: ['postgresql://user', 'pw@db.example.com:5432/app'].join(':'),
  redis: ['redis://user', 'pw@cache.example.com:6379'].join(':'),
  jwt: ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'A'.repeat(32)].join('.'),
};

describe('key-based redaction', () => {
  it.each([
    'password',
    'apiKey',
    'api_key',
    'ACCESS_KEY',
    'authorization',
    'clientSecret',
    'privateKey',
    'refreshToken',
  ])('treats %s as secret', (key) => {
    expect(isSecretKey(key)).toBe(true);
  });

  it.each(['name', 'count', 'purgedSessions', 'durationMs', 'toolName', 'keyword'])(
    'leaves %s alone',
    (key) => {
      expect(isSecretKey(key)).toBe(false);
    },
  );

  it('redacts a secret value while keeping the shape of the object', () => {
    const output = redact({
      user: 'ada',
      password: 'hunter2',
      nested: { apiKey: FAKE.openai, count: 3 },
    }) as Record<string, unknown>;

    expect(output['user']).toBe('ada');
    expect(output['password']).toBe(REDACTED);
    expect((output['nested'] as Record<string, unknown>)['count']).toBe(3);
    expect(JSON.stringify(output)).not.toContain('hunter2');
    expect(JSON.stringify(output)).not.toContain(FAKE.openai);
  });
});

describe('value-shape redaction', () => {
  it.each([
    [FAKE.openai, 'OpenAI-style key'],
    [FAKE.stripe, 'Stripe-style key'],
    [FAKE.github, 'GitHub token'],
    [FAKE.slack, 'Slack token'],
    [FAKE.postgres, 'connection string'],
    [FAKE.redis, 'redis URL'],
  ])('redacts a %s wherever it appears', (value) => {
    // Even under an innocent key name.
    const output = redact({ note: `the value is ${value}` }) as Record<string, string>;
    expect(output['note']).toContain(REDACTED);
    expect(output['note']).not.toContain(value);
  });

  it('redacts a JWT', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1';
    expect(redactString(jwt)).toBe(REDACTED);
  });

  it('leaves ordinary text intact', () => {
    const text = 'Discovered 5 tools on github-mcp in 412ms';
    expect(redactString(text)).toBe(text);
  });
});

describe('redaction limits', () => {
  it('breaks cycles instead of hanging', () => {
    const cyclic: Record<string, unknown> = { name: 'root' };
    cyclic['self'] = cyclic;
    expect(JSON.stringify(redact(cyclic))).toContain('circular');
  });

  it('stops at the depth limit', () => {
    let deep: Record<string, unknown> = { leaf: true };
    for (let i = 0; i < 30; i += 1) deep = { nested: deep };
    expect(JSON.stringify(redact(deep, 5))).toContain('depth-limit');
  });

  it('caps very long strings', () => {
    const output = redact({ body: 'x'.repeat(10_000) }, 6, 100) as Record<string, string>;
    expect(output['body'].length).toBeLessThan(200);
    expect(output['body']).toContain('truncated');
  });

  it('caps very long arrays', () => {
    const output = redact(Array.from({ length: 500 }, (_, i) => i)) as unknown[];
    expect(output.length).toBeLessThanOrEqual(101);
    expect(String(output.at(-1))).toContain('more');
  });

  it('summarises an Error without its stack', () => {
    const output = redact(new Error(`failed to connect using ${FAKE.openai}`)) as Record<
      string,
      string
    >;
    expect(output['name']).toBe('Error');
    expect(output['message']).toContain(REDACTED);
    expect(output['stack']).toBeUndefined();
  });
});

describe('the logger', () => {
  function capture(level = 'debug') {
    const lines: string[] = [];
    const logger = createLogger({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow to the level union
      level: level as any,
      format: 'json',
      sink: (line) => lines.push(line),
    });
    return { logger, lines };
  }

  it('writes structured JSON', () => {
    const { logger, lines } = capture();
    logger.info('Request completed', { route: 'GET /x', status: 200, durationMs: 12 });
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry).toMatchObject({ level: 'info', msg: 'Request completed', status: 200 });
    expect(entry.time).toBeTruthy();
  });

  it('redacts fields before writing them', () => {
    const { logger, lines } = capture();
    logger.info('Connecting', { apiKey: FAKE.openai, server: 'github' });
    expect(lines[0]).not.toContain(FAKE.openai);
    expect(lines[0]).toContain('github');
  });

  it('honours the level threshold', () => {
    const { logger, lines } = capture('warn');
    logger.debug('noisy');
    logger.info('also noisy');
    logger.warn('important');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('important');
  });

  it('merges child fields into every line', () => {
    const { logger, lines } = capture();
    logger.child({ requestId: 'req_1' }).info('Something happened');
    expect(JSON.parse(lines[0] ?? '{}').requestId).toBe('req_1');
  });
});

describe('request context', () => {
  it('makes the request id available to nested calls', () => {
    const result = runWithContext({ route: 'GET /x' }, () => {
      const outer = currentRequestId();
      const inner = (() => currentRequestId())();
      return { outer, inner };
    });
    expect(result.outer).toMatch(/^req_/);
    expect(result.inner).toBe(result.outer);
  });

  it('honours a supplied request id', () => {
    const id = newRequestId();
    expect(runWithContext({ requestId: id }, () => currentRequestId())).toBe(id);
  });

  it('does not leak a context between requests', () => {
    const first = runWithContext({}, () => currentRequestId());
    const second = runWithContext({}, () => currentRequestId());
    expect(first).not.toBe(second);
    expect(currentRequestId()).toBe('req_none');
  });

  it('survives an async boundary', async () => {
    const [outer, inner] = await runWithContext({}, async (ctx) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return [ctx.requestId, currentRequestId()];
    });
    expect(inner).toBe(outer);
  });
});

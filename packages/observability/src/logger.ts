import { redact } from './redact.js';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogFields {
  requestId?: string;
  organizationId?: string;
  userId?: string;
  route?: string;
  durationMs?: number;
  status?: number | string;
  [key: string]: unknown;
}

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** Returns a logger that merges `fields` into every subsequent line. */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** `json` for production aggregation, `pretty` for a human at a terminal. */
  format?: 'json' | 'pretty';
  base?: LogFields;
  sink?: (line: string) => void;
}

const COLORS: Record<LogLevel, string> = {
  debug: '\u001b[90m',
  info: '\u001b[36m',
  warn: '\u001b[33m',
  error: '\u001b[31m',
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const level = options.level ?? (process.env['LOG_LEVEL'] as LogLevel) ?? 'info';
  const format =
    options.format ?? (process.env['NODE_ENV'] === 'production' ? 'json' : 'pretty');
  const base = options.base ?? {};
  const sink = options.sink ?? ((line: string) => process.stdout.write(line + '\n'));
  const threshold = LEVEL_RANK[LOG_LEVELS.includes(level) ? level : 'info'];

  function emit(lineLevel: LogLevel, message: string, fields?: LogFields): void {
    if (LEVEL_RANK[lineLevel] < threshold) return;
    const merged = redact({ ...base, ...fields }) as Record<string, unknown>;
    const time = new Date().toISOString();
    if (format === 'json') {
      sink(JSON.stringify({ level: lineLevel, time, msg: message, ...merged }));
      return;
    }
    const extras = Object.entries(merged)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    sink(
      `${COLORS[lineLevel]}${lineLevel.toUpperCase().padEnd(5)}\u001b[0m ${time} ${message}${
        extras ? ` \u001b[90m${extras}\u001b[0m` : ''
      }`,
    );
  }

  return {
    debug: (m, f) => emit('debug', m, f),
    info: (m, f) => emit('info', m, f),
    warn: (m, f) => emit('warn', m, f),
    error: (m, f) => emit('error', m, f),
    child: (fields) => createLogger({ ...options, base: { ...base, ...fields } }),
  };
}

/** Process-wide default logger. Request handlers should use a child of this. */
export const logger = createLogger();

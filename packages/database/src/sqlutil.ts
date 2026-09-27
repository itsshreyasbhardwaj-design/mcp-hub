/**
 * Tiny parameterised-SQL helpers. Deliberately not an ORM: every statement in
 * the repositories stays readable SQL, and user input is only ever bound as a
 * positional parameter — never interpolated.
 */
export class Params {
  private readonly values: unknown[] = [];

  /** Binds a value and returns its `$n` placeholder. */
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }

  get all(): unknown[] {
    return this.values;
  }

  get length(): number {
    return this.values.length;
  }
}

export class WhereBuilder {
  private readonly clauses: string[] = [];

  constructor(private readonly params: Params) {}

  /** Adds `fragment` (which may reference `params.add(...)`) to the AND-chain. */
  and(fragment: string): this {
    this.clauses.push(fragment);
    return this;
  }

  /** Adds `column = $n` when `value` is neither undefined nor null. */
  eq(column: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.clauses.push(`${column} = ${this.params.add(value)}`);
    return this;
  }

  in(column: string, values: readonly unknown[] | undefined): this {
    if (!values || values.length === 0) return this;
    const placeholders = values.map((v) => this.params.add(v)).join(', ');
    this.clauses.push(`${column} in (${placeholders})`);
    return this;
  }

  gte(column: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.clauses.push(`${column} >= ${this.params.add(value)}`);
    return this;
  }

  lte(column: string, value: unknown): this {
    if (value === undefined || value === null) return this;
    this.clauses.push(`${column} <= ${this.params.add(value)}`);
    return this;
  }

  /** Case-insensitive contains. Escapes LIKE metacharacters. */
  contains(column: string, value: string | undefined | null): this {
    if (!value) return this;
    const escaped = value.replace(/[\\%_]/g, (c) => `\\${c}`);
    this.clauses.push(`${column} ilike ${this.params.add(`%${escaped}%`)}`);
    return this;
  }

  get sql(): string {
    return this.clauses.length ? `where ${this.clauses.join(' and ')}` : '';
  }

  get isEmpty(): boolean {
    return this.clauses.length === 0;
  }
}

/** Whitelist-based ORDER BY: never accepts a raw client string. */
export function orderBy<T extends string>(
  requested: string | undefined,
  allowed: Record<T, string>,
  fallback: T,
  direction: 'asc' | 'desc' = 'desc',
): string {
  const key = (requested && requested in allowed ? requested : fallback) as T;
  const dir = direction === 'asc' ? 'asc' : 'desc';
  return `order by ${allowed[key]} ${dir}`;
}

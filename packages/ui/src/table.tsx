import type { ReactNode } from 'react';
import { cn } from './cn.js';

export interface Column<T> {
  key: string;
  header: ReactNode;
  /** Right-align numeric columns so digits line up. */
  align?: 'left' | 'right';
  width?: string;
  render: (row: T) => ReactNode;
}

export interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: readonly T[];
  rowKey: (row: T) => string;
  empty?: ReactNode;
  caption?: string;
  className?: string;
  /** Applied to <tr>; use for row-level emphasis such as failures. */
  rowClassName?: (row: T) => string | undefined;
}

/**
 * A plain, accessible table. Semantic markup with a caption, scoped headers
 * and no ARIA grid role — a static table of records is a table, and screen
 * readers handle it better than a div grid pretending to be one.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  caption,
  className,
  rowClassName,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) return <>{empty}</>;

  return (
    <div className={cn('w-full overflow-x-auto', className)}>
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr className="border-b border-border">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-fg-4',
                  column.align === 'right' ? 'text-right' : 'text-left',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                'border-b border-border/60 last:border-0 hover:bg-surface-2/60',
                rowClassName?.(row),
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-3 py-2.5 align-top text-fg-2',
                    column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                  )}
                >
                  {column.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

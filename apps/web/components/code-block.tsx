'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/**
 * A copyable code block.
 *
 * Deliberately unhighlighted: syntax highlighting would add a large client
 * bundle for snippets that are read once, and monospace with good contrast is
 * enough for configuration and a few lines of TypeScript.
 */
export function CodeBlock({
  code,
  language,
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className={`overflow-hidden rounded-md border border-border ${className ?? ''}`}>
      <div className="flex items-center justify-between border-b border-border bg-surface-2 px-3 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-wide text-fg-4">
          {language ?? 'text'}
        </span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(code).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-fg-4 hover:text-fg-1"
        >
          {copied ? <Check className="size-3" aria-hidden /> : <Copy className="size-3" aria-hidden />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="max-h-96 overflow-auto bg-surface-1 p-3 font-mono text-[11px] leading-relaxed text-fg-2 scrollbar-thin">
        {code}
      </pre>
    </div>
  );
}

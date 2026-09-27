'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Badge, Card, CardBody, CardHeader, Note } from '@mcp-hub/ui';
import { ApiError, apiFetch } from '@/lib/api';

interface AssistantAnswer {
  question: string;
  intent: string;
  answer: string;
  evidence: Array<{ label: string; value: string; source: string; href?: string | null }>;
  insufficientEvidence: boolean;
  provider: string;
  model: string | null;
  deterministic: boolean;
}

const SUGGESTIONS = [
  'How many tool calls were there in the last week?',
  'Why is the flaky server failing?',
  'Which servers provide database search?',
  'What changed between 1.3.0 and 1.4.0?',
];

/**
 * The assistant.
 *
 * It answers from a fixed set of authorised queries against this
 * organization's own data. The evidence that produced an answer is always
 * shown, and when there is none the panel says so rather than guessing.
 */
export function AssistantPanel() {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<AssistantAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string): Promise<void> {
    if (text.trim().length < 3) return;
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      setAnswer(
        await apiFetch<AssistantAnswer>('/api/v1/assistant', {
          method: 'POST',
          body: { question: text },
        }),
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The assistant failed.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-1.5">
            <Sparkles className="size-3.5 text-accent" aria-hidden />
            Ask about this data
          </span>
        }
        description="Answers are derived from recorded events only."
      />
      <CardBody className="space-y-3">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void ask(question);
          }}
        >
          <label className="sr-only" htmlFor="assistant-question">
            Question
          </label>
          <input
            id="assistant-question"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Why is a server failing?"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-fg-1 placeholder:text-fg-4"
          />
          <button
            type="submit"
            disabled={loading || question.trim().length < 3}
            className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-surface-0 disabled:opacity-50"
          >
            {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : 'Ask'}
          </button>
        </form>

        {!answer && !loading ? (
          <div className="flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setQuestion(suggestion);
                  void ask(suggestion);
                }}
                className="rounded-md border border-border px-2 py-1 text-left text-[11px] text-fg-3 hover:text-fg-1"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}

        {answer ? (
          <div className="space-y-3">
            <div
              className={
                answer.insufficientEvidence
                  ? 'rounded-md border border-warning/30 bg-warning/5 p-3'
                  : 'rounded-md border border-border bg-surface-2/50 p-3'
              }
            >
              <p className="whitespace-pre-line text-sm leading-relaxed text-fg-2">
                {answer.answer}
              </p>
            </div>

            {answer.evidence.length > 0 ? (
              <div>
                <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-fg-4">
                  Evidence
                </p>
                <ul className="space-y-1">
                  {answer.evidence.map((item, index) => (
                    <li
                      key={`${item.label}-${index}`}
                      className="flex flex-wrap items-baseline gap-1.5 text-xs"
                    >
                      <span className="text-fg-4">{item.label}:</span>
                      <span className="text-fg-2">{item.value}</span>
                      {item.href ? (
                        <Link href={item.href} className="text-accent hover:underline">
                          view
                        </Link>
                      ) : null}
                      <code className="ml-auto font-mono text-[10px] text-fg-4">{item.source}</code>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
              <Badge tone="muted" className="text-[10px]">
                intent: {answer.intent}
              </Badge>
              <Badge tone={answer.deterministic ? 'success' : 'info'} className="text-[10px]">
                {answer.deterministic ? 'deterministic' : `model: ${answer.model}`}
              </Badge>
              <span className="text-[10px] text-fg-4">provider: {answer.provider}</span>
            </div>
          </div>
        ) : null}

        <Note>
          The model never queries the database. Intent selects one of a small set of pre-authorised
          queries, already scoped to this organization, and only their results are summarised.
        </Note>
      </CardBody>
    </Card>
  );
}

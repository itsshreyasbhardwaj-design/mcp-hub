'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The message is already logged server-side with a request id; this only
    // records that the boundary caught it in the browser.
    console.error('Dashboard error boundary', error.digest ?? error.message);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 text-center">
      <h1 className="text-lg font-semibold text-fg-1">Something went wrong</h1>
      <p className="mt-2 text-sm leading-relaxed text-fg-3">
        The error has been logged. If it keeps happening, the server logs carry the request id for
        this failure.
      </p>
      {error.digest ? (
        <code className="mt-3 font-mono text-xs text-fg-4">digest: {error.digest}</code>
      ) : null}
      <button
        type="button"
        onClick={reset}
        className="mx-auto mt-5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0"
      >
        Try again
      </button>
    </main>
  );
}

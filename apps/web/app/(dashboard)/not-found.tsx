import Link from 'next/link';
import { EmptyState } from '@mcp-hub/ui';
import { FileQuestion } from 'lucide-react';

export default function NotFound() {
  return (
    <EmptyState
      icon={<FileQuestion className="size-8" />}
      title="Not found"
      description="That page or resource does not exist, or it belongs to another organization."
      action={
        <Link
          href="/"
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-surface-0"
        >
          Back to the overview
        </Link>
      }
    />
  );
}

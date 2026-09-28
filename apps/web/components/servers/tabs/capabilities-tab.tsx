import type { ServerDetail } from '@mcp-hub/core';
import { Badge, Card, CardBody, CardHeader, EmptyState, KeyValue } from '@mcp-hub/ui';
import { FileText } from 'lucide-react';

export function CapabilitiesTab({ detail }: { detail: ServerDetail }) {
  const { resources, prompts } = detail;

  if (resources.length === 0 && prompts.length === 0) {
    return (
      <EmptyState
        icon={<FileText className="size-8" />}
        title="No resources or prompts"
        description="This server version exposes neither resources nor prompts. Run Discover if you expect it to."
      />
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader
          title="Resources"
          description="Data this server can expose to a client, addressed by URI."
        />
        {resources.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-4">None.</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {resources.map((resource) => (
              <li key={resource.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="break-all font-mono text-xs text-fg-1">{resource.uri}</code>
                  {resource.isTemplate ? <Badge tone="info">template</Badge> : null}
                  {resource.mimeType ? (
                    <Badge tone="muted" className="font-mono text-[10px]">
                      {resource.mimeType}
                    </Badge>
                  ) : null}
                </div>
                {resource.name ? <p className="mt-1 text-xs text-fg-2">{resource.name}</p> : null}
                {resource.description ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-fg-3">{resource.description}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Prompts"
          description="Reusable prompt templates the server offers to clients."
        />
        {prompts.length === 0 ? (
          <CardBody>
            <p className="text-sm text-fg-4">None.</p>
          </CardBody>
        ) : (
          <ul className="divide-y divide-border">
            {prompts.map((prompt) => (
              <li key={prompt.id} className="px-4 py-3">
                <code className="font-mono text-sm text-fg-1">{prompt.name}</code>
                {prompt.description ? (
                  <p className="mt-1 text-xs leading-relaxed text-fg-3">{prompt.description}</p>
                ) : null}
                {prompt.arguments.length > 0 ? (
                  <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                    {prompt.arguments.map((argument) => (
                      <KeyValue
                        key={argument.name}
                        label={`${argument.name}${argument.required ? ' *' : ''}`}
                      >
                        <span className="text-xs text-fg-3">
                          {argument.description ?? 'No description.'}
                        </span>
                      </KeyValue>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

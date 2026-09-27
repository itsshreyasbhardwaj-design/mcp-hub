#!/usr/bin/env node
/**
 * Example MCP server: an in-memory notebook.
 *
 * It exists so that MCP Hub's registration, discovery, validation,
 * compatibility testing, playground and health monitoring can all be
 * exercised against a real MCP implementation rather than a mock. The tool
 * set is chosen to cover every risk class the classifier recognises.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

interface Note {
  id: string;
  title: string;
  body: string;
  tags: string[];
  createdAt: string;
}

const notes = new Map<string, Note>();
let counter = 0;

function seed(title: string, body: string, tags: string[]): void {
  counter += 1;
  const id = `note-${counter}`;
  notes.set(id, { id, title, body, tags, createdAt: new Date().toISOString() });
}

seed('Welcome', 'This note lives inside the example MCP server.', ['intro']);
seed('Shopping', 'Coffee beans, oat milk, a new kettle.', ['personal', 'todo']);
seed('Architecture', 'Keep the transport layer dumb and the policy layer explicit.', ['work']);

const server = new McpServer(
  { name: 'example-notes-server', version: '1.2.0' },
  {
    capabilities: { tools: {}, resources: {}, prompts: {} },
    instructions:
      'A small notebook. Use list_notes to browse, search_notes to filter and create_note to add.',
  },
);

server.registerTool(
  'list_notes',
  {
    title: 'List notes',
    description: 'Returns every note in the notebook, newest first.',
    inputSchema: {
      limit: z.number().int().min(1).max(100).default(20).describe('Maximum notes to return'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ limit }) => {
    const items = [...notes.values()].slice(0, limit);
    return {
      content: [{ type: 'text', text: JSON.stringify(items, null, 2) }],
      structuredContent: { notes: items, total: notes.size },
    };
  },
);

server.registerTool(
  'search_notes',
  {
    title: 'Search notes',
    description: 'Finds notes whose title or body contains the query string.',
    inputSchema: {
      query: z.string().min(1).describe('Case-insensitive substring to look for'),
      tag: z.string().optional().describe('Restrict results to notes carrying this tag'),
    },
    annotations: { readOnlyHint: true },
  },
  async ({ query, tag }) => {
    const needle = query.toLowerCase();
    const matches = [...notes.values()].filter(
      (note) =>
        (note.title.toLowerCase().includes(needle) || note.body.toLowerCase().includes(needle)) &&
        (tag ? note.tags.includes(tag) : true),
    );
    return {
      content: [{ type: 'text', text: `${matches.length} note(s) matched "${query}".` }],
      structuredContent: { matches },
    };
  },
);

server.registerTool(
  'create_note',
  {
    title: 'Create a note',
    description: 'Adds a new note to the notebook and returns its identifier.',
    inputSchema: {
      title: z.string().min(1).describe('Short title for the note'),
      body: z.string().describe('Note contents'),
      tags: z.array(z.string()).default([]).describe('Optional labels'),
    },
  },
  async ({ title, body, tags }) => {
    counter += 1;
    const id = `note-${counter}`;
    notes.set(id, { id, title, body, tags, createdAt: new Date().toISOString() });
    return {
      content: [{ type: 'text', text: `Created ${id}.` }],
      structuredContent: { id },
    };
  },
);

server.registerTool(
  'delete_note',
  {
    title: 'Delete a note',
    description: 'Permanently removes a note. This cannot be undone.',
    inputSchema: { id: z.string().describe('Identifier of the note to delete') },
    annotations: { destructiveHint: true },
  },
  async ({ id }) => {
    const existed = notes.delete(id);
    return {
      content: [{ type: 'text', text: existed ? `Deleted ${id}.` : `No note ${id}.` }],
      structuredContent: { deleted: existed },
      isError: !existed,
    };
  },
);

server.registerTool(
  'sync_to_remote',
  {
    title: 'Sync to a remote endpoint',
    description: 'Pretends to push the notebook to a remote HTTP endpoint. Performs no network I/O.',
    inputSchema: {
      url: z.string().url().describe('Destination endpoint'),
      api_key: z.string().optional().describe('Bearer credential for the destination'),
    },
  },
  async ({ url }) => ({
    content: [{ type: 'text', text: `Would sync ${notes.size} note(s) to ${url}.` }],
    structuredContent: { synced: notes.size, url },
  }),
);

server.registerResource(
  'notebook',
  'notes://all',
  { title: 'Whole notebook', description: 'Every note as JSON', mimeType: 'application/json' },
  async (uri) => ({
    contents: [
      { uri: uri.href, mimeType: 'application/json', text: JSON.stringify([...notes.values()], null, 2) },
    ],
  }),
);

server.registerPrompt(
  'summarize_notes',
  {
    title: 'Summarise the notebook',
    description: 'Produces a prompt asking a model to summarise the current notes.',
    argsSchema: { style: z.string().optional().describe('Desired tone, e.g. "terse"') },
  },
  ({ style }) => ({
    messages: [
      {
        role: 'user',
        content: {
          type: 'text',
          text: `Summarise these notes${style ? ` in a ${style} style` : ''}:\n\n${[...notes.values()]
            .map((n) => `- ${n.title}: ${n.body}`)
            .join('\n')}`,
        },
      },
    ],
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);

/**
 * Minimal, hand-written MCP wire types.
 *
 * MCP Hub implements the client side itself rather than embedding an SDK so
 * that byte caps, timeouts, redirect policy and untrusted-content handling are
 * enforced at the transport boundary rather than bolted on around a library.
 */

export const JSONRPC_VERSION = '2.0';

/** Protocol revision MCP Hub advertises during initialize. */
export const SUPPORTED_PROTOCOL_VERSION = '2025-06-18';

/** Older revisions accepted from a server without downgrading the connection. */
export const COMPATIBLE_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: typeof JSONRPC_VERSION;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: typeof JSONRPC_VERSION;
  id: JsonRpcId;
  result?: unknown;
  error?: JsonRpcErrorObject;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export function isJsonRpcResponse(value: unknown): value is JsonRpcResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { jsonrpc?: unknown }).jsonrpc === JSONRPC_VERSION &&
    'id' in value &&
    (('result' in value) || ('error' in value))
  );
}

// --- MCP payload shapes ---------------------------------------------------

export interface InitializeResult {
  protocolVersion: string;
  capabilities: Record<string, unknown>;
  serverInfo: { name: string; version: string; title?: string };
  instructions?: string;
}

export interface McpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export interface McpResourceDefinition {
  uri: string;
  name?: string;
  title?: string;
  description?: string;
  mimeType?: string;
}

export interface McpResourceTemplateDefinition {
  uriTemplate: string;
  name?: string;
  description?: string;
  mimeType?: string;
}

export interface McpPromptDefinition {
  name: string;
  title?: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface McpContentBlock {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
  [key: string]: unknown;
}

export interface CallToolResult {
  content: McpContentBlock[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** JSON-RPC error codes MCP servers are expected to use. */
export const RPC_ERRORS = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

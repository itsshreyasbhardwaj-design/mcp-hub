import { apiRouter, fromWebRequest, toWebResponse } from '@mcp-hub/api';
import { HubError, toApiError } from '@mcp-hub/core';

/**
 * The REST API, mounted into Next.js.
 *
 * This file is deliberately thin: it converts a Web Request into the
 * framework-agnostic shape the router understands and converts the result
 * back. All routing, authentication, authorisation, rate limiting and error
 * mapping live in @mcp-hub/api, so the standalone server in apps/api and this
 * handler cannot drift apart.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  try {
    const hubRequest = await fromWebRequest(request);
    return toWebResponse(await apiRouter.handle(hubRequest));
  } catch (err) {
    const status = err instanceof HubError ? err.status : 500;
    return Response.json(toApiError(err, 'req_adapter'), { status });
  }
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
export const PUT = handle;
export const DELETE = handle;

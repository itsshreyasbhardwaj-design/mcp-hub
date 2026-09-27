export * from './context.js';
export * from './auth/index.js';
export * from './services/index.js';
export * from './http/index.js';
export * from './http/auth-routes.js';
export { seed, type SeedResult } from './seed.js';

import { Router } from './http/router.js';
import { routes } from './http/routes.js';
import { authRoutes } from './http/auth-routes.js';

/** The application's single route table, shared by every HTTP adapter. */
export const allRoutes = [...authRoutes, ...routes];
export const apiRouter = new Router(allRoutes);

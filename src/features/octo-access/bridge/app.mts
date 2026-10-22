import { createRequire } from 'node:module';
import { bridgePath } from './routes.mts';
const express = createRequire(import.meta.url)('express') as typeof import('express');
export function withBridgeRoutes(app: import('express').Express, routes?: import('express').Router) {
  if (!routes) return app;
  const outer = express();
  outer.use(bridgePath, routes); outer.use(app);
  Object.assign(outer.locals, app.locals);
  return outer;
}

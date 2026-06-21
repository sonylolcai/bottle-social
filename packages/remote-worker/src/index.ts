import { Hono } from "hono";
import type { Env } from "./db";
import { registerRoutes } from "./routes";

const app = new Hono<{ Bindings: Env }>();

registerRoutes(app);

export { registerRoutes };
export type { Env };
export default app;

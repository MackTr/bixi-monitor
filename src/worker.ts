import { handleApi } from "./api";
import { collect } from "./collector";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

export default {
  // API routes are owned here; everything else is a static asset (the dashboard).
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
      return handleApi(request, env);
    }
    return env.ASSETS.fetch(request);
  },

  // Cron: poll the feed and store on change. Errors are logged, never thrown,
  // so one bad poll can't wedge the schedule.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      collect(env).then(
        (results) => console.log("collect:", JSON.stringify(results)),
        (err) => console.error("collect failed:", err instanceof Error ? err.message : err),
      ),
    );
  },
} satisfies ExportedHandler<Env>;

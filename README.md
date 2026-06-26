# BIXI Monitor — station 345 (Regina / de Verdun)

Always-on monitoring + analytics for one BIXI station, on Cloudflare Workers + D1. A cron Worker
polls the GBFS feed every minute and stores state **on change**; a versioned, CORS'd `/api/v1`
serves the data; a zero-dependency SVG dashboard is its first client.

See [docs/api.md](docs/api.md) for the API contract.

## Develop locally
```bash
npm install
npm run build                 # builds the dashboard into ./dist
npm run db:migrate:local      # create tables in the local D1
npm run dev                   # wrangler dev -> http://localhost:8787
```
Trigger a collection in dev: `curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"`.

## Deploy (needs a free Cloudflare account)
```bash
npx wrangler login
npx wrangler d1 create bixi345     # paste the printed database_id into wrangler.toml
npm run db:migrate                  # apply migrations to remote D1
npm run deploy                      # builds + deploys the Worker (cron starts automatically)
```

## Layout
- `src/collector.ts` — poll feed, store on change (+ heartbeat)
- `src/analytics.ts` — episodes, heatmap, morning stats (timezone-aware)
- `src/api.ts` — `/api/v1` router + CORS
- `src/worker.ts` — `scheduled()` + `fetch()` entrypoint
- `web/` — SVG dashboard (Vite → `./dist`)

# Deploying Teamo on Netlify + Supabase

Teamo's backend was fully rewritten in Node.js to run as a single Netlify Function
(Express wrapped with `serverless-http`), backed by Supabase (Postgres, Realtime,
Storage) instead of local SQLite + disk. `teamo/main.py` (Flask) is kept in the repo as
a reference — it's what every Node route was ported from — but it is **not** the runtime
Netlify serves; everything below is about the Node/Supabase stack in `server/`,
`netlify/`, and `netlify.toml`.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and run `teamo/supabase/schema.sql` once. It's idempotent
   (`CREATE TABLE IF NOT EXISTS`, `ON CONFLICT DO NOTHING` throughout) — safe to re-run.
   It creates all 14 tables, enables Realtime on `room_chat`, sets up the one RLS policy
   Realtime needs, and creates the private `task-attachments` Storage bucket.
3. From Project Settings → API, copy the **Project URL**, **anon public key**, and
   **service_role key**. From Project Settings → Database, copy the connection string
   (**Session pooler** or direct connection; put the real password in it, not the
   bracketed placeholder Supabase's UI shows).

## 2. Seed permissions + demo accounts (new projects only)

The Flask app seeded the `permissions` table and demo accounts on every startup
(`init_db()`/`seed()` in `main.py`). A Netlify Function has no equivalent "startup"
moment, so this is a one-off script instead:

```
cp .env.example .env   # fill in the values from step 1
node server/seed.js
```

Safe to re-run: permissions use `ON CONFLICT DO NOTHING`, and the demo accounts/settings
rows are only inserted if the `users` table is still empty.

## 3. Environment variables

Set these in the Netlify site (Site configuration → Environment variables) — not just
in a local `.env`, which Netlify never sees:

| Variable | Where it's used | Notes |
|---|---|---|
| `SUPABASE_URL` | `server/*`, `GET /api/public-config` | also sent to the browser — it's meant to be public |
| `SUPABASE_ANON_KEY` | `GET /api/public-config` | sent to the browser for Realtime (Presence/Broadcast/chat) — meant to be public, that's what RLS is for |
| `SUPABASE_SERVICE_KEY` | `server/realtime.js`, `server/storage.js` | **secret** — bypasses RLS; server-side only, never sent to the browser |
| `DATABASE_URL` | `server/db.js` | **secret** — direct Postgres connection, used for every query/write |
| `SECRET_KEY` | `server/auth.js` | **secret** — signs the session JWT; must stay fixed across deploys or everyone gets logged out |
| `TEAMO_ICE_SERVERS` | `server/app.js` (Teamo Meet) | optional; JSON array of your own STUN/TURN servers, e.g. `[{"urls":"stun:stun.l.google.com:19302"}]`. Without it, Teamo Meet still works on the same network/NAT but may fail to connect across stricter NATs/firewalls. |

## 4. Deploy

No build step (plain Node.js, nothing to compile):

- Connect the GitHub repo in the Netlify dashboard (New site → Import an existing
  project), or run `netlify init` from this directory and follow the prompts.
- Build command: none. Publish directory: `teamo/frontend` (already set in
  `netlify.toml`). Functions directory: `netlify/functions` (also already set).
- Push to `main` (or whatever branch Netlify is watching) and it deploys automatically.
  For a one-off manual deploy: `netlify deploy --prod`.

## 5. Local development

Two ways to run it locally, for different purposes:

- **`node server/local.js`** — plain Express on port 8970, no Netlify emulation. Fast
  iteration; use this for day-to-day route work.
- **`npx netlify-cli dev`** — the real Netlify Function + redirects + env var injection.
  Slower to start, but it's the only way to catch things that only break under the real
  runtime (the Python-Functions mistake and the multipart-upload-through-`serverless-http`
  check earlier in this project both needed this, not the fast path). Use this before
  calling a phase done.

Both need a `.env` in the repo root with the variables from step 3.

## 6. Cutover

The old Flask + SQLite server (`teamo/main.py`) still runs standalone
(`python main.py`) against its own local `teamo.db` — entirely separate from the
Supabase-backed Node stack described above; they don't share data once you start using
the Node version against Supabase. Decide when you're ready:

- **Keep both running in parallel** for a while (e.g. point a few test users at the
  Netlify URL while everyone else stays on the local Flask server) — safest, but the two
  are on separate databases, so anything done in one doesn't show up in the other.
- **Cut over fully**: once you're satisfied with the Netlify deployment, stop running
  `main.py` day-to-day. It can stay in the repo as a reference (that's how this port was
  built and verified), or be removed later — your call, not something to decide by
  default.

## Appendix: what changed from the Flask version, and why

- **No long-polling.** The old `/api/rooms/<code>/poll` (15s long-poll) and `/api/pulse`
  (an in-memory counter) both relied on a persistent process; neither can exist in a
  Netlify Function, which is stateless and time-limited per invocation. Both are replaced
  with Supabase Realtime (Presence + Broadcast for Teamo Meet, a Broadcast channel for the
  dashboard "something changed" signal).
- **No local disk.** Task attachments moved from `teamo/uploads/` to a private Supabase
  Storage bucket; uploads are buffered in memory (`multer`), not written to disk.
- **Passwords still work.** Existing password hashes (werkzeug's `scrypt:N:r:p$salt$hash`
  format) verify correctly from Node — `server/auth.js` reimplements werkzeug's scrypt
  parameters exactly, so nobody needs to reset a password after cutover.
- **One accepted security trade-off**: Supabase Realtime's `room_chat` SELECT policy is
  unconditional (`USING (true)`) because Teamo authenticates with its own JWT rather than
  Supabase Auth, so RLS has no per-user identity to scope by. Anyone holding the anon key
  (public by design) could read any room's chat over Realtime, not just their own room.
  Room codes have ~41 bits of entropy and are never listed anywhere, so this is the same
  trust model as the meeting link itself — but it's worth knowing if a Teamo Meet link
  ever gets pasted somewhere public.

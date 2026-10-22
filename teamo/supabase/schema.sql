-- Teamo — Postgres schema for Supabase.
-- Run this once in the Supabase SQL editor (or `supabase db push`) on a fresh project.
-- This is the consolidated equivalent of main.py's old SQLite SCHEMA plus every
-- incremental ALTER TABLE that used to run in init_db() — written fresh here since
-- there's no existing Postgres database to migrate forward from.

CREATE TABLE IF NOT EXISTS users(
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'employee',
  department TEXT DEFAULT '',
  designation TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  joined TEXT,
  status TEXT DEFAULT 'Offline',
  active INTEGER DEFAULT 1,
  color TEXT DEFAULT '#6366f1',
  address TEXT DEFAULT '',
  gender TEXT DEFAULT '',
  personal_email TEXT DEFAULT '',
  approval TEXT DEFAULT 'approved'
);

CREATE TABLE IF NOT EXISTS tasks(
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  assigned_to INTEGER,
  created_by INTEGER,
  priority TEXT DEFAULT 'Medium',
  status TEXT DEFAULT 'Assigned',
  due_date TEXT,
  created_at TEXT,
  completed_at TEXT,
  work_note TEXT DEFAULT '',
  project TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS attendance(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  check_in TEXT,
  check_out TEXT,
  status TEXT DEFAULT 'Present',
  note TEXT DEFAULT '',
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS breaks(
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT
);

CREATE TABLE IF NOT EXISTS task_attachments(
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  stored TEXT NOT NULL,
  uploaded_by TEXT,
  ts TEXT,
  url TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS task_feedback(
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT DEFAULT '',
  author TEXT,
  ts TEXT
);

CREATE TABLE IF NOT EXISTS meeting_join_requests(
  meeting_id INTEGER,
  user_id INTEGER,
  status TEXT DEFAULT 'pending',
  ts TEXT,
  PRIMARY KEY(meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS task_comments(
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  user_id INTEGER,
  author TEXT,
  role TEXT,
  text TEXT NOT NULL,
  ts TEXT
);

CREATE TABLE IF NOT EXISTS task_activity(
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  kind TEXT,
  text TEXT,
  detail TEXT DEFAULT '',
  actor TEXT,
  role TEXT,
  ts TEXT
);

CREATE TABLE IF NOT EXISTS meetings(
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  location TEXT DEFAULT '',
  created_by INTEGER,
  room_code TEXT DEFAULT '',
  ended_early INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meeting_participants(
  meeting_id INTEGER,
  user_id INTEGER,
  PRIMARY KEY(meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings(
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS mail_log(
  id SERIAL PRIMARY KEY,
  to_addr TEXT,
  subject TEXT,
  status TEXT,
  error TEXT DEFAULT '',
  ts TEXT
);

CREATE TABLE IF NOT EXISTS permissions(
  role TEXT,
  perm TEXT,
  allowed INTEGER,
  PRIMARY KEY(role, perm)
);

CREATE TABLE IF NOT EXISTS audit_log(
  id SERIAL PRIMARY KEY,
  user_id INTEGER,
  user_name TEXT,
  action TEXT,
  details TEXT,
  ip TEXT,
  ts TEXT
);

-- ---------------------------------------------------------------------------
-- New: meeting-room chat history. Everything else about a live Teamo Meet
-- room (who's connected, mic/cam/hand state, WebRTC signaling, reactions) is
-- ephemeral and handled entirely by Supabase Realtime Presence/Broadcast on
-- the client — it never touches Postgres, the same way it never touched
-- SQLite before (it lived in the old in-memory ROOMS dict). Chat is the one
-- piece that needs to persist across reconnects/page reloads, matching the
-- old behavior of returning the last 50 messages on join.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS room_chat(
  id SERIAL PRIMARY KEY,
  room_code TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  ts TEXT
);
CREATE INDEX IF NOT EXISTS room_chat_room_idx ON room_chat(room_code, id);

-- Enable Realtime on room_chat so meet.js can subscribe to new messages.
ALTER PUBLICATION supabase_realtime ADD TABLE room_chat;

-- The Express backend connects as the Postgres superuser and always bypasses RLS, so this
-- only governs the browser's direct anon-key Realtime subscription: it may SELECT (so new
-- messages are pushed live) but has no INSERT/UPDATE/DELETE policy, so direct writes from
-- the browser are refused — all writes still go through the authenticated /api/rooms/:code/chat
-- route. Note the SELECT policy is unconditional (no per-room scoping): Supabase Realtime's
-- RLS check runs as the anon role with no notion of "this browser is a participant of this
-- meeting" (Teamo doesn't use Supabase Auth), so anyone holding the public anon key could in
-- principle read other rooms' chat history over Realtime. Room codes are generated with ~41
-- bits of entropy and never listed anywhere, so this is the same trust model as the meeting
-- link itself, not a new exposure — but it's a real, accepted trade-off, not a false one.
ALTER TABLE room_chat ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_chat_select_anon ON room_chat FOR SELECT USING (true);

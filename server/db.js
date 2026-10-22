// Postgres (Supabase) access, shaped like teamo/main.py's row()/rows()/execute()
// helpers so ported routes read close to a transliteration of the Python originals.
const { Pool, types } = require("pg");
const { pulse } = require("./realtime");

// node-postgres returns BIGINT (COUNT(*), etc.) as strings by default, to avoid
// precision loss past Number.MAX_SAFE_INTEGER. Nothing in Teamo's counts gets
// anywhere near that, and the old Python driver always returned plain ints, so
// parse them as numbers to match — otherwise every count silently becomes a
// string and breaks arithmetic/comparisons throughout the frontend.
types.setTypeParser(20, (v) => parseInt(v, 10)); // int8/bigint

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// "?" placeholders (same convention as the old SQLite/psycopg2 code) -> "$1,$2,..."
function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

async function rows(sql, args = []) {
  const r = await pool.query(toPg(sql), args);
  return r.rows;
}

async function row(sql, args = []) {
  const r = await rows(sql, args);
  return r[0] || null;
}

// Tables whose primary key isn't a single auto-incrementing "id" column.
const NO_ID_TABLES = new Set(["permissions", "settings", "meeting_participants", "meeting_join_requests"]);

async function execute(sql, args = []) {
  let pg = toPg(sql);
  const m = /^\s*INSERT\s+INTO\s+(\w+)/i.exec(pg);
  const wantsId = !!m && !NO_ID_TABLES.has(m[1]) && !/RETURNING/i.test(pg);
  if (wantsId) pg += " RETURNING id";
  const r = await pool.query(pg, args);
  pulse().catch(() => {}); // best-effort: a missed live-refresh nudge is never worth failing the write for
  return wantsId ? (r.rows[0] ? r.rows[0].id : null) : null;
}

module.exports = { pool, rows, row, execute };

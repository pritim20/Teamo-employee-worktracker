// Small date/time + settings/audit helpers, ported from teamo/main.py.
const { row, rows, execute } = require("./db");

const pad = (n) => String(n).padStart(2, "0");

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowTime() {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function nowTs() {
  const d = new Date();
  return `${today()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

async function setting(key, def = "") {
  const r = await row("SELECT value FROM settings WHERE key=?", [key]);
  return r ? r.value : def;
}

async function audit(req, action, details = "") {
  const u = req.user || null;
  await execute(
    "INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(?,?,?,?,?,?)",
    [u ? u.id : null, u ? u.name : "Anonymous", action, details, req.get("X-Forwarded-For") || req.ip, nowTs()]
  );
}

function meetingState(m) {
  const t = nowTime(), d = today();
  if (m.ended_early || m.date < d || (m.date === d && m.end_time <= t)) return "Completed";
  if (m.date === d && m.start_time <= t && t < m.end_time) return "In Progress";
  return "Scheduled";
}

// Live status shown on the dashboards. Only employees are tracked this way
// (admins/managers don't have a monitored live status).
async function markInMeeting(uid, on) {
  if (on) await execute("UPDATE users SET status='In Meeting' WHERE id=? AND role='employee'", [uid]);
  else await execute("UPDATE users SET status='Available' WHERE id=? AND role='employee' AND status='In Meeting'", [uid]);
}

async function inMeetingIds() {
  const d = today(), t = nowTime();
  const [scheduled, live] = await Promise.all([
    rows("SELECT mp.user_id FROM meetings m JOIN meeting_participants mp ON mp.meeting_id=m.id " +
      "WHERE m.date=? AND m.start_time<=? AND m.end_time>? AND m.ended_early=0", [d, t, t]),
    rows("SELECT id FROM users WHERE status='In Meeting' AND active=1 AND role='employee'"),
  ]);
  return new Set([...scheduled.map((r) => r.user_id), ...live.map((r) => r.id)]);
}

module.exports = { today, nowTime, nowTs, addDays, setting, audit, meetingState, inMeetingIds, markInMeeting };

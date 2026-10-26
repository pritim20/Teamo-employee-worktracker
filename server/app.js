// Express app — ported from teamo/main.py. Routes are added here phase by phase;
// see /home/jsn/.claude/plans/snoopy-dreaming-moler.md for the build order.
const crypto = require("crypto");
const express = require("express");
const cookieParser = require("cookie-parser");
const multer = require("multer");

const { row, rows, execute } = require("./db");
const {
  generatePasswordHash, checkPasswordHash, writeSession, attachSession,
  publicUser, userPerms, requireLogin, requireStaff, requireEmployee, needsPerm, COOKIE_NAME,
} = require("./auth");
const { today, nowTime, nowTs, addDays, setTimezone, getTimezone, refreshTimezone, setting, audit, meetingState, inMeetingIds, markInMeeting } = require("./util");
const { ALL_PERMS, EMPLOYEE_PERMS, LOCKED, MAIL_KEYS, STATUSES } = require("./constants");
const { mailConfig, sendMail, mailHtml, mailRegistrationReceived, mailCredentials, mailRejected } = require("./mail");
const { broadcast } = require("./realtime");
const { uploadFile, removeFiles, signedUrl } = require("./storage");

const app = express();

// Express 4 doesn't catch a rejected promise from an `async (req, res) => {...}` handler —
// it becomes an unhandled rejection, which crashes the whole function (opaque
// "Runtime exited with error: exit status 1" in Netlify's logs, no detail at all) instead
// of a readable error response. Wrap every route handler once, here, so a DB hiccup or any
// other thrown/rejected error reaches the error-handling middleware below as a normal 500.
for (const method of ["get", "post", "put", "delete"]) {
  const original = app[method].bind(app);
  app[method] = (path, ...handlers) =>
    original(path, ...handlers.map((h) =>
      typeof h === "function"
        ? (req, res, next) => { try { Promise.resolve(h(req, res, next)).catch(next); } catch (e) { next(e); } }
        : h
    ));
}

app.use(async (req, res, next) => { await refreshTimezone(); next(); });
app.use(express.json());
app.use(cookieParser());
app.use(attachSession);

// ----------------------------------------------------------------- auth

app.post("/api/login", async (req, res) => {
  const b = req.body || {};
  const email = (b.email || "").trim().toLowerCase();
  const portal = b.portal || "employee";
  const u = await row("SELECT * FROM users WHERE lower(email)=?", [email]);
  if (!u || !checkPasswordHash(u.password, b.password || "")) {
    await execute(
      "INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(NULL,?,?,?,?,?)",
      [email || "unknown", "LOGIN_FAILED", `Failed login on ${portal} portal`, req.ip, nowTs()]
    );
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (u.approval === "pending") return res.status(403).json({ error: "Your registration is still waiting for a manager's approval. We'll email you once it's reviewed." });
  if (u.approval === "rejected") return res.status(403).json({ error: "Your registration wasn't approved. Contact your manager if you think this is a mistake." });
  if (!u.active) return res.status(403).json({ error: "Your account is deactivated. Contact your admin." });
  if (portal === "admin" && u.role === "employee") return res.status(403).json({ error: "Invalid email or password" });
  if (portal === "employee" && u.role !== "employee") return res.status(403).json({ error: "Invalid email or password" });

  const key = u.role === "employee" ? "uid_employee" : "uid_admin";
  writeSession(res, { ...req.sessionData, [key]: u.id });
  req.user = u;
  if (u.role !== "employee" || u.status === "Offline") await execute("UPDATE users SET status='Available' WHERE id=?", [u.id]);
  await audit(req, "LOGIN", `Logged in to ${portal} portal`);
  res.json({ ok: true, redirect: u.role === "employee" ? "/employee" : "/admin" });
});

app.post("/api/logout", requireLogin(), async (req, res) => {
  await audit(req, "LOGOUT", "Logged out");
  await execute("UPDATE users SET status='Offline' WHERE id=?", [req.user.id]);
  const rest = { ...req.sessionData };
  delete rest[`uid_${req.portal}`];
  writeSession(res, rest);
  res.json({ ok: true });
});

app.get("/api/me", requireLogin(), async (req, res) => {
  res.json({ user: publicUser(req.user), perms: await userPerms(req.user), company: await setting("company_name", "Teamo"), server_time: nowTs(), timezone: getTimezone() });
});

// Rate limit is per warm function instance only (no shared store yet) — good enough
// to blunt casual abuse; a proper cross-instance limit is a later hardening pass.
const REG_ATTEMPTS = new Map();

app.post("/api/register", async (req, res) => {
  const ip = req.ip, now = Date.now();
  const attempts = (REG_ATTEMPTS.get(ip) || []).filter((t) => now - t < 3600_000);
  if (attempts.length >= 5) return res.status(429).json({ error: "Too many registrations from this device. Try again later." });

  const b = req.body || {};
  const name = (b.name || "").trim(), email = (b.email || "").trim().toLowerCase();
  if (!name || !email) return res.status(400).json({ error: "Name and email are required" });
  const domain = email.split("@").pop() || "";
  if (!email.includes("@") || !domain.includes(".") || email.includes(" ")) return res.status(400).json({ error: "Enter a valid email address" });
  const phone = (b.phone || "").trim(), address = (b.address || "").trim(), gender = (b.gender || "").trim();
  const digits = phone.replace(/\D/g, "");
  if (!phone || digits.length < 7 || digits.length > 15 || /[^0-9+\-() ]/.test(phone)) return res.status(400).json({ error: "Enter a valid phone number" });
  if (!address) return res.status(400).json({ error: "Address is required" });
  if (!["Male", "Female", "Other"].includes(gender)) return res.status(400).json({ error: "Select your gender" });

  const old = await row("SELECT * FROM users WHERE lower(personal_email)=? OR lower(email)=?", [email, email]);
  if (old && old.approval !== "rejected") {
    return res.status(400).json({ error: old.approval === "approved" ? "An account for this email already exists" : "A registration for this email is already waiting for approval" });
  }
  attempts.push(now);
  REG_ATTEMPTS.set(ip, attempts);

  if (old) {
    await execute("UPDATE users SET name=?,phone=?,address=?,gender=?,approval='pending',active=0,joined=? WHERE id=?",
      [name.slice(0, 100), phone.slice(0, 30), address.slice(0, 300), gender, today(), old.id]);
  } else {
    // no login yet: the manager assigns the company email id and password when approving.
    // "email" is UNIQUE NOT NULL, so pending registrations get a throwaway placeholder,
    // same as teamo/main.py did.
    const { COLORS } = require("./constants");
    const placeholder = `pending-${crypto.randomBytes(6).toString("hex")}@registration.invalid`;
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    await execute(
      "INSERT INTO users(name,email,personal_email,password,role,phone,address,gender,joined,color,active,approval) VALUES(?,?,?,?,'employee',?,?,?,?,?,0,'pending')",
      [name.slice(0, 100), placeholder, email, generatePasswordHash(crypto.randomBytes(16).toString("hex")), phone.slice(0, 30), address.slice(0, 300), gender, today(), color]
    );
  }
  await execute("INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(NULL,?,?,?,?,?)",
    [name, "REGISTER", `New registration from ${email} (waiting for approval)`, ip, nowTs()]);
  mailRegistrationReceived({ name, email });
  res.json({ ok: true });
});

// ----------------------------------------------------------------- employees

app.get("/api/employees", requireStaff("employees.view"), async (req, res) => {
  const role = req.query.role;
  let sql = "SELECT * FROM users WHERE approval='approved'";
  const args = [];
  if (role) { sql += " AND role=?"; args.push(role); }
  if (req.user.role === "manager") sql += " AND role!='admin'";
  const users = (await rows(sql + " ORDER BY role, name", args)).map(publicUser);
  res.json(users);
});

// ----------------------------------------------------------------- admin: dashboard

app.get("/api/admin/dashboard", requireStaff(), async (req, res) => {
  const d = today();
  // Each query below is a separate round trip to Supabase over the network (unlike the
  // old local SQLite file), so independent queries run in parallel rather than one
  // sequential await per query — the sequential version took 4-10+ seconds.
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(d, -(6 - i)));
  const taskStatuses = ["Assigned", "In Progress", "Submitted", "Approved"];

  const [
    emps, attRows, meetIds, pendingRow, overdueRow, weekCounts, taskStatCounts,
    meetingsToday, recent, departments, topTasks,
  ] = await Promise.all([
    rows("SELECT id,name,designation,department,status,color FROM users WHERE role='employee' AND active=1 ORDER BY name"),
    rows("SELECT * FROM attendance WHERE date=?", [d]),
    inMeetingIds(),
    row("SELECT COUNT(*) c FROM tasks WHERE status!='Approved'"),
    row("SELECT COUNT(*) c FROM tasks WHERE status!='Approved' AND due_date<?", [d]),
    Promise.all(weekDays.map((dd) => row("SELECT COUNT(*) c FROM attendance WHERE date=? AND status IN ('Present','Late')", [dd]))),
    Promise.all(taskStatuses.map((s) => row("SELECT COUNT(*) c FROM tasks WHERE status=?", [s]))),
    rows("SELECT m.*, (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id=m.id) participants FROM meetings m WHERE date=? ORDER BY start_time", [d]),
    rows("SELECT * FROM audit_log ORDER BY id DESC LIMIT 6"),
    rows("SELECT department label, COUNT(*) value FROM users WHERE role='employee' AND active=1 GROUP BY department ORDER BY value DESC"),
    rows("SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.status!='Approved' " +
      "ORDER BY CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, due_date LIMIT 6"),
  ]);

  const att = Object.fromEntries(attRows.map((r) => [r.user_id, r]));
  const present = emps.filter((e) => ["Present", "Late"].includes(att[e.id]?.status)).length;
  const late = emps.filter((e) => att[e.id]?.status === "Late").length;
  const onLeave = emps.filter((e) => att[e.id]?.status === "Leave").length;
  const pending = pendingRow.c, overdue = overdueRow.c;

  const week = weekDays.map((dd, i) => ({
    label: new Date(`${dd}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" }), date: dd, value: weekCounts[i].c,
  }));
  const taskStats = Object.fromEntries(taskStatuses.map((s, i) => [s, taskStatCounts[i].c]));

  const live = emps.map((e) => {
    const a = att[e.id];
    let st;
    if (meetIds.has(e.id)) st = "In Meeting";
    else if (!a || ["Absent", "Leave"].includes(a.status) || !a.check_in) st = (a && ["Absent", "Leave"].includes(a.status)) ? a.status : "Not checked in";
    else if (a.check_out) st = "Checked out";
    else st = e.status;
    return { ...e, live_status: st, check_in: a ? a.check_in : null };
  });

  for (const m of meetingsToday) m.state = meetingState(m);
  const empIds = new Set(emps.map((e) => e.id));
  res.json({
    total: emps.length, present, absent: emps.length - present - onLeave, late, on_leave: onLeave,
    in_meeting: [...meetIds].filter((i) => empIds.has(i)).length,
    pending_tasks: pending, overdue, week, task_stats: taskStats, live,
    meetings_today: meetingsToday, recent, departments, top_tasks: topTasks,
  });
});

function validateUserPayload(b, creating) {
  if (creating) {
    for (const f of ["name", "email", "password"]) {
      if (!(b[f] || "").trim()) return `${f[0].toUpperCase()}${f.slice(1)} is required`;
    }
  }
  if (b.email && !b.email.includes("@")) return "Enter a valid email";
  if (b.role && !["admin", "manager", "employee"].includes(b.role)) return "Invalid role";
  return null;
}

app.post("/api/employees", requireStaff("employees.manage"), async (req, res) => {
  const b = req.body || {};
  const err = validateUserPayload(b, true);
  if (err) return res.status(400).json({ error: err });
  const role = b.role || "employee";
  if (role === "admin" && req.user.role !== "admin") return res.status(403).json({ error: "Only admins can create admin accounts" });
  if (await row("SELECT id FROM users WHERE lower(email)=?", [b.email.trim().toLowerCase()])) return res.status(400).json({ error: "Email already exists" });
  const { COLORS } = require("./constants");
  const uid = await execute(
    "INSERT INTO users(name,email,password,role,department,designation,phone,joined,color,address,gender) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    [b.name.trim(), b.email.trim().toLowerCase(), generatePasswordHash(b.password), role, b.department || "", b.designation || "",
     b.phone || "", b.joined || today(), COLORS[Math.floor(Math.random() * COLORS.length)], (b.address || "").slice(0, 300),
     ["Male", "Female", "Other"].includes(b.gender) ? b.gender : ""]
  );
  await audit(req, "EMPLOYEE_CREATE", `Created ${role} ${b.name} (${b.email})`);
  res.json({ ok: true, id: uid });
});

app.put("/api/employees/:uid", requireStaff("employees.manage"), async (req, res) => {
  const uid = Number(req.params.uid);
  const b = req.body || {};
  const u = await row("SELECT * FROM users WHERE id=?", [uid]);
  if (!u) return res.status(404).json({ error: "Not found" });
  const me = req.user;
  if (me.role !== "admin" && (u.role === "admin" || b.role === "admin")) return res.status(403).json({ error: "Only admins can modify admin accounts" });
  const err = validateUserPayload(b, false);
  if (err) return res.status(400).json({ error: err });
  if (uid === me.id && b.role && b.role !== u.role) return res.status(400).json({ error: "You cannot change your own role" });
  const fields = {};
  for (const k of ["name", "email", "role", "department", "designation", "phone", "address", "gender", "joined", "active"]) {
    if (k in b) fields[k] = b[k];
  }
  if ("email" in fields) {
    fields.email = fields.email.trim().toLowerCase();
    if (await row("SELECT id FROM users WHERE lower(email)=? AND id!=?", [fields.email, uid])) return res.status(400).json({ error: "Email already exists" });
  }
  if (b.password) fields.password = generatePasswordHash(b.password);
  const keys = Object.keys(fields);
  if (keys.length) {
    await execute(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`, [...keys.map((k) => fields[k]), uid]);
  }
  await audit(req, "EMPLOYEE_UPDATE", `Updated ${u.name}: ${keys.filter((k) => k !== "password").join(", ") || "password"}`);
  res.json({ ok: true });
});

app.delete("/api/employees/:uid", requireStaff("employees.manage"), async (req, res) => {
  const uid = Number(req.params.uid);
  const u = await row("SELECT * FROM users WHERE id=?", [uid]);
  if (!u) return res.status(404).json({ error: "Not found" });
  if (uid === req.user.id) return res.status(400).json({ error: "You cannot delete yourself" });
  if (u.role === "admin" && req.user.role !== "admin") return res.status(403).json({ error: "Only admins can delete admin accounts" });
  await execute("DELETE FROM meeting_participants WHERE user_id=?", [uid]);
  await execute("DELETE FROM attendance WHERE user_id=?", [uid]);
  await execute("UPDATE tasks SET assigned_to=NULL WHERE assigned_to=?", [uid]);
  await execute("DELETE FROM users WHERE id=?", [uid]);
  await audit(req, "EMPLOYEE_DELETE", `Deleted ${u.name} (${u.email})`);
  res.json({ ok: true });
});

// ----------------------------------------------------------------- self-registration & manager approval

app.get("/api/registrations", requireStaff("employees.manage"), async (req, res) => {
  res.json(await rows("SELECT id,name,personal_email email,phone,address,gender,joined FROM users WHERE approval='pending' ORDER BY id"));
});

app.post("/api/registrations/:uid/decision", requireStaff("employees.manage"), async (req, res) => {
  const uid = Number(req.params.uid);
  const u = await row("SELECT * FROM users WHERE id=? AND approval='pending'", [uid]);
  if (!u) return res.status(404).json({ error: "This registration was already handled" });
  const b = req.body || {};
  if (b.decision === "approve") {
    const login = (b.email || "").trim().toLowerCase(), pw = b.password || "";
    const domain = login.split("@").pop() || "";
    if (!login.includes("@") || !domain.includes(".") || login.includes(" ")) return res.status(400).json({ error: "Enter the employee's company email id" });
    if (pw.length < 6) return res.status(400).json({ error: "The password must be at least 6 characters" });
    if (await row("SELECT id FROM users WHERE lower(email)=? AND id!=?", [login, uid])) return res.status(400).json({ error: "That email id is already used by someone else" });
    await execute("UPDATE users SET approval='approved', active=1, email=?, password=?, department=?, designation=? WHERE id=?",
      [login, generatePasswordHash(pw), (b.department || "").trim().slice(0, 80), (b.designation || "").trim().slice(0, 80), uid]);
    await audit(req, "REGISTRATION_APPROVE", `Approved ${u.name} as ${login}`);
    // The frontend already has a graceful fallback for emailed:false — it shows the
    // credentials for the admin to share manually if sending fails or mail isn't set up.
    // employees sign in at their own page, /employee-login (see teamo/frontend/employee-login.html).
    const baseUrl = `${req.protocol}://${req.get("host")}/employee-login`;
    const err = await mailCredentials(u, login, pw, baseUrl);
    return res.json({ ok: true, emailed: !err, error: err || undefined, personal_email: u.personal_email });
  }
  if (b.decision === "reject") {
    const reason = (b.reason || "").trim().slice(0, 300);
    await execute("UPDATE users SET approval='rejected', active=0 WHERE id=?", [uid]);
    await audit(req, "REGISTRATION_REJECT", `Rejected ${u.name} (${u.personal_email})`);
    mailRejected(u, reason);
    return res.json({ ok: true });
  }
  res.status(400).json({ error: "Invalid decision" });
});

// ----------------------------------------------------------------- admin: tasks

app.get("/api/tasks", requireStaff("tasks.manage"), async (req, res) => {
  let sql = "SELECT t.*, u.name assignee, u.color assignee_color, c.name creator, (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=t.id) comment_count FROM tasks t " +
    "LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN users c ON c.id=t.created_by WHERE 1=1";
  const args = [];
  for (const key of ["status", "priority"]) {
    if (req.query[key]) { sql += ` AND t.${key}=?`; args.push(req.query[key]); }
  }
  if (req.query.assigned_to) { sql += " AND t.assigned_to=?"; args.push(req.query.assigned_to); }
  res.json(await rows(sql + " ORDER BY t.id DESC", args));
});

async function logTask(req, tid, kind, text, detail = "") {
  const u = req.user;
  await execute("INSERT INTO task_activity(task_id,kind,text,detail,actor,role,ts) VALUES(?,?,?,?,?,?,?)",
    [tid, kind, text, detail, u ? u.name : "System", u ? u.role : "", nowTs()]);
}

app.post("/api/tasks", requireStaff("tasks.manage"), async (req, res) => {
  const b = req.body || {};
  if (!(b.title || "").trim()) return res.status(400).json({ error: "Title is required" });
  const tid = await execute(
    "INSERT INTO tasks(title,description,assigned_to,created_by,priority,status,due_date,created_at,project) VALUES(?,?,?,?,?,?,?,?,?)",
    [b.title.trim(), b.description || "", b.assigned_to || null, req.user.id, b.priority || "Medium", "Assigned",
     b.due_date || today(), nowTs(), (b.project || "").trim().slice(0, 80)]
  );
  let extra = "";
  if (b.assigned_to) {
    const assignee = await row("SELECT name FROM users WHERE id=?", [b.assigned_to]);
    if (assignee) extra = ` and assigned it to ${assignee.name}`;
  }
  await logTask(req, tid, "created", `created the task${extra}`);
  await audit(req, "TASK_CREATE", `Task #${tid} '${b.title}'`);
  res.json({ ok: true, id: tid });
});

app.delete("/api/tasks/:tid", requireStaff("tasks.manage"), async (req, res) => {
  const tid = Number(req.params.tid);
  const t = await row("SELECT * FROM tasks WHERE id=?", [tid]);
  if (!t) return res.status(404).json({ error: "Not found" });
  const atts = await rows("SELECT stored FROM task_attachments WHERE task_id=? AND stored!=''", [tid]);
  await removeFiles(atts.map((a) => a.stored)).catch(() => {});
  await execute("DELETE FROM task_attachments WHERE task_id=?", [tid]);
  await execute("DELETE FROM task_feedback WHERE task_id=?", [tid]);
  await execute("DELETE FROM task_comments WHERE task_id=?", [tid]);
  await execute("DELETE FROM task_activity WHERE task_id=?", [tid]);
  await execute("DELETE FROM tasks WHERE id=?", [tid]);
  await audit(req, "TASK_DELETE", `Task #${tid} '${t.title}' deleted`);
  res.json({ ok: true });
});

// task, isStaff -- current user is the assignee, or staff with tasks.manage.
async function taskForUser(req, tid) {
  const u = req.user;
  const t = await row("SELECT * FROM tasks WHERE id=?", [tid]);
  if (!u || !t) return [null, false];
  if (["admin", "manager"].includes(u.role) && (await userPerms(u)).includes("tasks.manage")) return [t, true];
  return t.assigned_to === u.id ? [t, false] : [null, false];
}

app.get("/api/tasks/:tid/info", requireLogin(), async (req, res) => {
  const [t] = await taskForUser(req, Number(req.params.tid));
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json({
    task: t,
    attachments: await rows("SELECT id,filename,url,uploaded_by,ts FROM task_attachments WHERE task_id=? ORDER BY id", [t.id]),
    feedback: await rows("SELECT * FROM task_feedback WHERE task_id=? ORDER BY id DESC", [t.id]),
  });
});

app.get("/api/tasks/:tid/activity", requireLogin(), async (req, res) => {
  const [t] = await taskForUser(req, Number(req.params.tid));
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json({
    task: { id: t.id, title: t.title, status: t.status },
    events: await rows("SELECT * FROM task_activity WHERE task_id=? ORDER BY id DESC", [t.id]),
  });
});

app.get("/api/tasks/:tid/comments", requireLogin(), async (req, res) => {
  const [t] = await taskForUser(req, Number(req.params.tid));
  if (!t) return res.status(404).json({ error: "Task not found" });
  res.json({
    task: { id: t.id, title: t.title, status: t.status }, me: req.user.id,
    comments: await rows("SELECT * FROM task_comments WHERE task_id=? ORDER BY id", [t.id]),
  });
});

app.post("/api/tasks/:tid/comments", requireLogin(), async (req, res) => {
  const [t] = await taskForUser(req, Number(req.params.tid));
  if (!t) return res.status(404).json({ error: "Task not found" });
  const text = ((req.body || {}).text || "").trim();
  if (!text) return res.status(400).json({ error: "Write a message first" });
  if (text.length > 2000) return res.status(400).json({ error: "Message is too long (2000 characters max)" });
  const u = req.user;
  await execute("INSERT INTO task_comments(task_id,user_id,author,role,text,ts) VALUES(?,?,?,?,?,?)", [t.id, u.id, u.name, u.role, text, nowTs()]);
  res.json({ ok: true });
});

const MAX_FILE_MB = 10, MAX_FILES = 5;
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_FILE_MB * 1024 * 1024, files: MAX_FILES } });

function secureFilename(name) {
  name = String(name || "").split(/[/\\]/).pop(); // drop any directory part the browser sent
  name = name.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  name = name.replace(/[^A-Za-z0-9_.-]/g, "_").replace(/_+/g, "_").replace(/^\.+/, "");
  return name.slice(0, 200) || "file";
}

function cleanLinks(raw) {
  return (raw || "").replace(/,/g, "\n").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    .map((u) => (/^https?:\/\//i.test(u) ? u : "https://" + u).slice(0, 500));
}

app.post("/api/tasks/:tid/attachments", requireLogin(), upload.array("files", MAX_FILES), async (req, res) => {
  const tid = Number(req.params.tid);
  const u = req.user;
  const [t, staff] = await taskForUser(req, tid);
  if (!t) return res.status(404).json({ error: "Task not found" });
  if (t.status === "Approved") return res.status(400).json({ error: "This task is already approved" });
  if (!staff) {
    const g = await needsPerm(req, "tasks.work", "work on tasks");
    if (g) return res.status(403).json(g);
    if (t.status !== "In Progress") return res.status(400).json({ error: "Start the task before attaching work" });
  }
  const files = req.files || [];
  const links = cleanLinks((req.body || {}).links);
  if (!files.length && !links.length) return res.status(400).json({ error: "Choose a file or paste a link" });
  for (const l of links) {
    const afterScheme = l.split("//")[1] || "";
    if (l.includes(" ") || !afterScheme.includes(".")) return res.status(400).json({ error: `'${l}' doesn't look like a valid link` });
  }
  const saved = [];
  for (const f of files) {
    if (f.size === 0) { await removeFiles(saved.map(([, st]) => st)).catch(() => {}); return res.status(400).json({ error: `${f.originalname} is empty` }); }
    const name = secureFilename(f.originalname);
    const stored = crypto.randomBytes(16).toString("hex") + "_" + name;
    try {
      await uploadFile(stored, f.buffer, f.mimetype);
    } catch (e) {
      await removeFiles(saved.map(([, st]) => st)).catch(() => {});
      return res.status(500).json({ error: "Couldn't save the file. Try again." });
    }
    saved.push([name, stored]);
  }
  for (const [name, stored] of saved) {
    await execute("INSERT INTO task_attachments(task_id,filename,stored,uploaded_by,ts) VALUES(?,?,?,?,?)", [tid, name, stored, u.name, nowTs()]);
  }
  for (const l of links) {
    await execute("INSERT INTO task_attachments(task_id,filename,stored,url,uploaded_by,ts) VALUES(?,?,?,?,?,?)", [tid, l, "", l, u.name, nowTs()]);
  }
  const bits = [];
  if (saved.length) bits.push(`${saved.length} file${saved.length !== 1 ? "s" : ""}`);
  if (links.length) bits.push(`${links.length} link${links.length !== 1 ? "s" : ""}`);
  await logTask(req, tid, "file", "attached " + bits.join(" and "), [...saved.map(([n]) => n), ...links].join(", "));
  await audit(req, "TASK_ATTACH", `${bits.join(" and ")} attached to task #${tid}`);
  res.json({ ok: true });
});

app.get("/api/attachments/:aid", requireLogin(), async (req, res) => {
  const aid = Number(req.params.aid);
  const a = await row("SELECT * FROM task_attachments WHERE id=?", [aid]);
  const [t] = a ? await taskForUser(req, a.task_id) : [null, false];
  if (!t || !a.stored) return res.status(404).json({ error: "File not found" });
  try {
    res.redirect(await signedUrl(a.stored, 60, a.filename));
  } catch (e) {
    res.status(404).json({ error: "File not found" });
  }
});

app.delete("/api/task-attachments/:aid", requireLogin(), async (req, res) => {
  const aid = Number(req.params.aid);
  const a = await row("SELECT * FROM task_attachments WHERE id=?", [aid]);
  const [t, staff] = a ? await taskForUser(req, a.task_id) : [null, false];
  if (!t) return res.status(404).json({ error: "Not found" });
  if (!staff && (a.uploaded_by !== req.user.name || !["Assigned", "In Progress"].includes(t.status))) {
    return res.status(403).json({ error: "You can only remove your own attachments before submitting" });
  }
  if (a.stored) await removeFiles([a.stored]).catch(() => {});
  await execute("DELETE FROM task_attachments WHERE id=?", [aid]);
  await logTask(req, a.task_id, "file", "removed an attachment", a.url || a.filename);
  res.json({ ok: true });
});

app.post("/api/tasks/:tid/review", requireStaff("tasks.manage"), async (req, res) => {
  const tid = Number(req.params.tid);
  const t = await row("SELECT * FROM tasks WHERE id=?", [tid]);
  if (!t) return res.status(404).json({ error: "Not found" });
  if (t.status !== "Submitted") return res.status(400).json({ error: "Only submitted work can be reviewed" });
  const b = req.body || {};
  const decision = b.decision, comment = (b.comment || "").trim();
  const me = req.user.name;
  if (decision === "approve") {
    await execute("UPDATE tasks SET status='Approved', completed_at=? WHERE id=?", [today(), tid]);
    await execute("INSERT INTO task_feedback(task_id,kind,text,author,ts) VALUES(?,?,?,?,?)", [tid, "approved", comment, me, nowTs()]);
    await logTask(req, tid, "approved", "approved the work", comment);
  } else if (decision === "changes") {
    if (!comment) return res.status(400).json({ error: "Tell the employee what needs to change" });
    await execute("UPDATE tasks SET status='Assigned', completed_at=NULL WHERE id=?", [tid]);
    await execute("INSERT INTO task_feedback(task_id,kind,text,author,ts) VALUES(?,?,?,?,?)", [tid, "changes", comment, me, nowTs()]);
    await logTask(req, tid, "changes", "requested changes and sent the task back to the employee", comment);
  } else {
    return res.status(400).json({ error: "Invalid decision" });
  }
  await audit(req, "TASK_REVIEW", `Task #${tid} '${t.title}': ${decision}`);
  res.json({ ok: true });
});

// ----------------------------------------------------------------- admin: attendance

app.get("/api/attendance", requireStaff("attendance.manage"), async (req, res) => {
  const d = req.query.date || today();
  const emps = await rows("SELECT id,name,department,designation,color FROM users WHERE role='employee' AND active=1 ORDER BY name");
  const attRows = await rows("SELECT * FROM attendance WHERE date=?", [d]);
  const att = Object.fromEntries(attRows.map((r) => [r.user_id, r]));
  const out = emps.map((e) => {
    const a = att[e.id];
    return { ...e, check_in: a ? a.check_in : null, check_out: a ? a.check_out : null, status: a ? a.status : "Not marked", note: a ? a.note : "" };
  });
  res.json({ date: d, records: out });
});

app.post("/api/attendance", requireStaff("attendance.manage"), async (req, res) => {
  const b = req.body || {};
  const uid = b.user_id, d = b.date || today();
  const st = b.status || "Present";
  if (!["Present", "Late", "Absent", "Leave"].includes(st)) return res.status(400).json({ error: "Invalid status" });
  let ci = b.check_in || null, co = b.check_out || null;
  if (["Absent", "Leave"].includes(st)) ci = co = null;
  const existing = await row("SELECT id FROM attendance WHERE user_id=? AND date=?", [uid, d]);
  if (existing) {
    await execute("UPDATE attendance SET status=?, check_in=?, check_out=?, note=? WHERE id=?", [st, ci, co, b.note || "", existing.id]);
  } else {
    await execute("INSERT INTO attendance(user_id,date,check_in,check_out,status,note) VALUES(?,?,?,?,?,?)", [uid, d, ci, co, st, b.note || ""]);
  }
  const u = await row("SELECT name FROM users WHERE id=?", [uid]);
  await audit(req, "ATTENDANCE_MARK", `${u ? u.name : uid} marked ${st} on ${d}`);
  res.json({ ok: true });
});

// ----------------------------------------------------------------- admin: meetings

async function meetingWithParticipants(m) {
  m.participants = await rows("SELECT u.id,u.name,u.color FROM meeting_participants mp JOIN users u ON u.id=mp.user_id WHERE mp.meeting_id=?", [m.id]);
  m.state = meetingState(m);
  return m;
}

app.get("/api/meetings", requireStaff("meetings.manage"), async (req, res) => {
  const ms = await rows("SELECT m.*, u.name organiser FROM meetings m LEFT JOIN users u ON u.id=m.created_by ORDER BY date DESC, start_time");
  const out = await Promise.all(ms.map(async (m) => {
    await meetingWithParticipants(m);
    m.join_requests = await rows("SELECT r.user_id,r.status,r.ts,u.name FROM meeting_join_requests r JOIN users u ON u.id=r.user_id WHERE r.meeting_id=? ORDER BY r.ts", [m.id]);
    return m;
  }));
  res.json(out);
});

app.post("/api/meetings/:mid/join-requests/:uid", requireStaff("meetings.manage"), async (req, res) => {
  const mid = Number(req.params.mid), uid = Number(req.params.uid);
  const decision = (req.body || {}).decision;
  if (!["approve", "deny"].includes(decision)) return res.status(400).json({ error: "Invalid decision" });
  const r = await row("SELECT * FROM meeting_join_requests WHERE meeting_id=? AND user_id=?", [mid, uid]);
  if (!r) return res.status(404).json({ error: "Request not found" });
  await execute("UPDATE meeting_join_requests SET status=? WHERE meeting_id=? AND user_id=?", [decision === "approve" ? "approved" : "denied", mid, uid]);
  await audit(req, `MEETING_JOIN_${decision.toUpperCase()}`, `Join request for meeting #${mid} by user #${uid}: ${decision}`);
  // room_poke() (wakes a waiting poller) is part of the realtime rewrite, not ported yet.
  res.json({ ok: true });
});

const ROOM_CODE_LETTERS = "abcdefghjkmnpqrstuvwxyz";
async function newRoomCode() {
  for (;;) {
    const code = [3, 4, 3].map((n) => Array.from({ length: n }, () => ROOM_CODE_LETTERS[crypto.randomInt(ROOM_CODE_LETTERS.length)]).join("")).join("-");
    if (!(await row("SELECT id FROM meetings WHERE room_code=?", [code]))) return code;
  }
}

async function saveMeeting(req, b, mid = null) {
  for (const f of ["title", "date", "start_time", "end_time"]) {
    if (!b[f]) return [null, `${f.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())} is required`];
  }
  if (b.end_time <= b.start_time) return [null, "End time must be after start time"];
  if (!mid) {
    const t = nowTime(), d = today();
    if (b.date < d || (b.date === d && b.end_time <= t)) return [null, "This meeting's date and time have already passed. Check the date and time and try again."];
  }
  const old = mid ? await row("SELECT room_code FROM meetings WHERE id=?", [mid]) : null;
  let code = "";
  if (b.teamo_room) code = old && old.room_code ? old.room_code : await newRoomCode();
  const location = code ? `/meet/${code}` : (b.location || "").trim();
  if (mid) {
    await execute("UPDATE meetings SET title=?,description=?,date=?,start_time=?,end_time=?,location=?,room_code=? WHERE id=?",
      [b.title, b.description || "", b.date, b.start_time, b.end_time, location, code, mid]);
    await execute("DELETE FROM meeting_participants WHERE meeting_id=?", [mid]);
  } else {
    mid = await execute("INSERT INTO meetings(title,description,date,start_time,end_time,location,created_by,room_code) VALUES(?,?,?,?,?,?,?,?)",
      [b.title, b.description || "", b.date, b.start_time, b.end_time, location, req.user.id, code]);
  }
  for (const uid of new Set(b.participants || [])) {
    await execute("INSERT INTO meeting_participants VALUES(?,?) ON CONFLICT (meeting_id,user_id) DO NOTHING", [mid, Number(uid)]);
  }
  return [mid, null];
}

app.post("/api/meetings", requireStaff("meetings.manage"), async (req, res) => {
  const [mid, err] = await saveMeeting(req, req.body || {});
  if (err) return res.status(400).json({ error: err });
  await audit(req, "MEETING_CREATE", `Meeting #${mid} '${(req.body || {}).title}'`);
  res.json({ ok: true, id: mid });
});

app.put("/api/meetings/:mid", requireStaff("meetings.manage"), async (req, res) => {
  const mid = Number(req.params.mid);
  if (!(await row("SELECT id FROM meetings WHERE id=?", [mid]))) return res.status(404).json({ error: "Not found" });
  const [, err] = await saveMeeting(req, req.body || {}, mid);
  if (err) return res.status(400).json({ error: err });
  await audit(req, "MEETING_UPDATE", `Meeting #${mid} updated`);
  res.json({ ok: true });
});

app.delete("/api/meetings/:mid", requireStaff("meetings.manage"), async (req, res) => {
  const mid = Number(req.params.mid);
  const m = await row("SELECT * FROM meetings WHERE id=?", [mid]);
  if (!m) return res.status(404).json({ error: "Not found" });
  await execute("DELETE FROM meeting_participants WHERE meeting_id=?", [mid]);
  await execute("DELETE FROM meeting_join_requests WHERE meeting_id=?", [mid]);
  await execute("DELETE FROM meetings WHERE id=?", [mid]);
  await audit(req, "MEETING_DELETE", `Meeting '${m.title}' deleted`);
  res.json({ ok: true });
});

// ----------------------------------------------------------------- reports

function hoursBetween(a, b) {
  if (!a || !b) return 0.0;
  const [h1, m1] = a.split(":").map(Number), [h2, m2] = b.split(":").map(Number);
  return Math.max(0, Math.round((((h2 * 60 + m2) - (h1 * 60 + m1)) / 60) * 100) / 100);
}

async function employeeReport(uid, dFrom, dTo) {
  const att = await rows("SELECT * FROM attendance WHERE user_id=? AND date BETWEEN ? AND ?", [uid, dFrom, dTo]);
  const present = att.filter((a) => ["Present", "Late"].includes(a.status)).length;
  const late = att.filter((a) => a.status === "Late").length;
  const absent = att.filter((a) => a.status === "Absent").length;
  const leave = att.filter((a) => a.status === "Leave").length;
  const hours = Math.round(att.reduce((s, a) => s + hoursBetween(a.check_in, a.check_out), 0) * 10) / 10;
  const tasks = await rows("SELECT status FROM tasks WHERE assigned_to=?", [uid]);
  const done = tasks.filter((t) => t.status === "Approved").length;
  const meetings = (await row(
    "SELECT COUNT(*) c FROM meeting_participants mp JOIN meetings m ON m.id=mp.meeting_id WHERE mp.user_id=? AND m.date BETWEEN ? AND ?", [uid, dFrom, dTo]
  )).c;
  const marked = present + absent;
  return {
    present, late, absent, leave, hours,
    avg_hours: present ? Math.round((hours / present) * 10) / 10 : 0,
    attendance_rate: marked ? Math.round((100 * present) / marked) : 0,
    tasks_total: tasks.length, tasks_done: done,
    completion_rate: tasks.length ? Math.round((100 * done) / tasks.length) : 0, meetings,
  };
}

async function attendanceHistory(uid, dFrom, dTo) {
  let where = "a.date BETWEEN ? AND ?";
  const args = [dFrom, dTo];
  if (uid) { where += " AND a.user_id=?"; args.push(uid); }
  const recs = await rows(
    "SELECT a.date,a.check_in,a.check_out,a.status,u.id user_id,u.name,u.department,u.color FROM attendance a " +
    "JOIN users u ON u.id=a.user_id WHERE u.role='employee' AND " + where + " ORDER BY a.date DESC, u.name", args
  );
  for (const r of recs) r.hours = hoursBetween(r.check_in, r.check_out);
  return recs;
}

async function completedTasks(uid, dFrom, dTo) {
  let where = "t.status='Approved' AND t.completed_at BETWEEN ? AND ?";
  const args = [dFrom, dTo];
  if (uid) { where += " AND t.assigned_to=?"; args.push(uid); }
  return rows("SELECT t.id,t.title,t.priority,t.due_date,t.completed_at,t.work_note,u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE " + where + " ORDER BY t.completed_at DESC", args);
}

function reportRange(req) {
  const dTo = req.query.to || today();
  const dFrom = req.query.from || addDays(dTo, -29);
  return [dFrom, dTo];
}

app.get("/api/reports", requireStaff("reports.view"), async (req, res) => {
  const [dFrom, dTo] = reportRange(req);
  const emps = await rows("SELECT id,name,department,designation,color FROM users WHERE role='employee' AND active=1 ORDER BY name");
  const data = await Promise.all(emps.map(async (e) => ({ ...e, ...(await employeeReport(e.id, dFrom, dTo)) })));

  const trendDays = [];
  for (let d = new Date(`${dFrom}T00:00:00`), end = new Date(`${dTo}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() >= 1 && d.getDay() <= 5) trendDays.push(new Date(d));
  }
  const trend = await Promise.all(trendDays.map(async (d) => {
    const iso = d.toISOString().slice(0, 10);
    const c = (await row("SELECT COUNT(*) c FROM attendance WHERE date=? AND status IN ('Present','Late')", [iso])).c;
    return { label: d.toLocaleDateString("en-US", { day: "2-digit", month: "short" }), value: c };
  }));
  const dept = {};
  for (const r of data) {
    const key = r.department || "Other";
    dept[key] = dept[key] || { label: key, hours: 0, done: 0 };
    dept[key].hours += r.hours;
    dept[key].done += r.tasks_done;
  }
  res.json({
    range: { from: dFrom, to: dTo }, employees: data, trend,
    records: await attendanceHistory(null, dFrom, dTo), completed_tasks: await completedTasks(null, dFrom, dTo), departments: Object.values(dept),
    totals: {
      hours: Math.round(data.reduce((s, r) => s + r.hours, 0) * 10) / 10,
      avg_attendance: data.length ? Math.round(data.reduce((s, r) => s + r.attendance_rate, 0) / data.length) : 0,
      tasks_done: data.reduce((s, r) => s + r.tasks_done, 0),
      late: data.reduce((s, r) => s + r.late, 0),
    },
  });
});

function csvField(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function csvRow(fields) { return fields.map(csvField).join(",") + "\r\n"; }

app.get("/api/reports/export", requireStaff("reports.view"), async (req, res) => {
  const [dFrom, dTo] = reportRange(req);
  const emps = await rows("SELECT id,name,department,designation FROM users WHERE role='employee' AND active=1 ORDER BY name");
  let csv = csvRow(["Name", "Department", "Designation", "Present", "Late", "Absent", "Leave", "Hours",
    "Avg Hours/Day", "Attendance %", "Tasks", "Tasks Done", "Completion %", "Meetings"]);
  for (const e of emps) {
    const r = await employeeReport(e.id, dFrom, dTo);
    csv += csvRow([e.name, e.department, e.designation, r.present, r.late, r.absent, r.leave, r.hours,
      r.avg_hours, r.attendance_rate, r.tasks_total, r.tasks_done, r.completion_rate, r.meetings]);
  }
  await audit(req, "REPORT_EXPORT", `Exported report ${dFrom} to ${dTo}`);
  res.set("Content-Type", "text/csv");
  res.set("Content-Disposition", `attachment; filename=teamo_report_${dFrom}_${dTo}.csv`);
  res.send(csv);
});

// ----------------------------------------------------------------- settings / permissions / audit

app.get("/api/settings", requireStaff(), async (req, res) => {
  const settingsRows = await rows("SELECT * FROM settings");
  const out = {};
  for (const r of settingsRows) if (!r.key.startsWith("mail_")) out[r.key] = r.value;
  if ((await userPerms(req.user)).includes("settings.manage")) {
    const cfg = await mailConfig();
    for (const [k, v] of Object.entries(cfg)) if (k !== "mail_password") out[k] = v;
    out.mail_password_set = !!cfg.mail_password;
  }
  res.json(out);
});

app.put("/api/settings", requireStaff("settings.manage"), async (req, res) => {
  const b = { ...(req.body || {}) };
  const allowed = ["company_name", "work_start", "work_end", "late_grace_minutes", "timezone", "week_start", ...MAIL_KEYS];
  if ("mail_port" in b && String(b.mail_port).trim() && !/^\d+$/.test(String(b.mail_port).trim())) return res.status(400).json({ error: "Mail port must be a number" });
  if (b.mail_password === "") delete b.mail_password; // blank means "keep the saved password"
  if ("timezone" in b && !setTimezone(String(b.timezone).trim())) return res.status(400).json({ error: "Unknown timezone. Use a name like Asia/Kolkata or Europe/London." });
  for (const k of allowed) {
    if (k in b) await execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", [k, String(b[k])]);
  }
  await audit(req, "SETTINGS_UPDATE", allowed.filter((k) => k in b).map((k) => `${k}=${k === "mail_password" ? "***" : b[k]}`).join(", "));
  res.json({ ok: true });
});

app.put("/api/account/password", requireLogin(), async (req, res) => {
  const b = req.body || {};
  const u = req.user;
  if (!checkPasswordHash(u.password, b.current || "")) return res.status(400).json({ error: "Current password is incorrect" });
  if ((b.new || "").length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
  await execute("UPDATE users SET password=? WHERE id=?", [generatePasswordHash(b.new), u.id]);
  await audit(req, "PASSWORD_CHANGE", "Changed own password");
  res.json({ ok: true });
});

app.get("/api/permissions", requireStaff(), async (req, res) => {
  const grants = {};
  for (const r of await rows("SELECT * FROM permissions")) grants[`${r.role}:${r.perm}`] = !!r.allowed;
  const isLocked = (role, k) => LOCKED.some(([lr, lk]) => lr === role && lk === k);
  const staff = Object.entries(ALL_PERMS).map(([k, v]) => ({
    key: k, label: v,
    admin: (grants[`admin:${k}`] ?? true) || isLocked("admin", k),
    manager: grants[`manager:${k}`] ?? false,
    locked_admin: isLocked("admin", k),
  }));
  const emp = Object.entries(EMPLOYEE_PERMS).map(([k, v]) => ({ key: k, label: v, employee: grants[`employee:${k}`] ?? true }));
  res.json({ perms: staff, employee_perms: emp });
});

app.put("/api/permissions", requireStaff("permissions.manage"), async (req, res) => {
  const b = req.body || {};
  const changed = [];
  const isLocked = (role, k) => LOCKED.some(([lr, lk]) => lr === role && lk === k);
  for (const [role, keys] of [["admin", ALL_PERMS], ["manager", ALL_PERMS], ["employee", EMPLOYEE_PERMS]]) {
    for (const k of Object.keys(keys)) {
      if (b[role] && k in b[role]) {
        const on = !!b[role][k] || isLocked(role, k);
        await execute("INSERT INTO permissions VALUES(?,?,?) ON CONFLICT(role,perm) DO UPDATE SET allowed=excluded.allowed", [role, k, on ? 1 : 0]);
        changed.push(`${role}.${k}=${on ? "on" : "off"}`);
      }
    }
  }
  await audit(req, "PERMISSIONS_UPDATE", changed.join(", "));
  res.json({ ok: true });
});

app.get("/api/audit", requireStaff("audit.view"), async (req, res) => {
  const q = (req.query.q || "").trim();
  let sql = "SELECT * FROM audit_log", args = [];
  if (q) { sql += " WHERE action LIKE ? OR details LIKE ? OR user_name LIKE ?"; args = [`%${q}%`, `%${q}%`, `%${q}%`]; }
  res.json(await rows(sql + " ORDER BY id DESC LIMIT 500", args));
});

// ----------------------------------------------------------------- employee API

async function breakMinutes(uid, d) {
  let total = 0, ongoing = false;
  for (const b of await rows("SELECT * FROM breaks WHERE user_id=? AND date=?", [uid, d])) {
    const end = b.end_time || nowTime();
    ongoing = ongoing || !b.end_time;
    total += Math.max(0, Math.floor(hoursBetween(b.start_time, end) * 60 + 0.5));
  }
  return [total, ongoing];
}

async function todayAtt(uid) {
  const a = await row("SELECT * FROM attendance WHERE user_id=? AND date=?", [uid, today()]);
  if (a) [a.break_minutes, a.on_break] = await breakMinutes(uid, today());
  return a;
}

async function myMeetings(uid, d = null) {
  let sql = "SELECT m.*, u.name organiser FROM meetings m JOIN meeting_participants mp ON mp.meeting_id=m.id LEFT JOIN users u ON u.id=m.created_by WHERE mp.user_id=?";
  const args = [uid];
  if (d) { sql += " AND m.date=?"; args.push(d); }
  const found = await rows(sql + " ORDER BY m.date DESC, m.start_time", args);
  return Promise.all(found.map(async (m) => {
    await meetingWithParticipants(m);
    const r = await row("SELECT status FROM meeting_join_requests WHERE meeting_id=? AND user_id=?", [m.id, uid]);
    m.join_status = r ? r.status : "none";
    m.has_link = /^(https?:\/\/|\/meet\/)/i.test(m.location || "");
    if (m.has_link && m.join_status !== "approved") m.location = "";
    return m;
  }));
}

app.get("/api/me/dashboard", requireEmployee(), async (req, res) => {
  const u = req.user, d = today();
  const dow = new Date(`${d}T00:00:00`).getDay(); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? 6 : dow - 1;
  const weekFrom = addDays(d, -mondayOffset);

  const [tasks, allTasks, week, meetIds, attendance, meetings, workStart, workEnd] = await Promise.all([
    rows(
      "SELECT *, (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=tasks.id) comment_count, " +
      "(SELECT text FROM task_feedback f WHERE f.task_id=tasks.id ORDER BY f.id DESC LIMIT 1) last_feedback, " +
      "(SELECT kind FROM task_feedback f WHERE f.task_id=tasks.id ORDER BY f.id DESC LIMIT 1) last_feedback_kind FROM tasks " +
      "WHERE assigned_to=? AND (due_date<=? AND status!='Approved' OR due_date=?) " +
      "ORDER BY CASE status WHEN 'Approved' THEN 1 ELSE 0 END, CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END",
      [u.id, d, d]
    ),
    rows("SELECT status FROM tasks WHERE assigned_to=?", [u.id]),
    rows("SELECT * FROM attendance WHERE user_id=? AND date>=? ORDER BY date", [u.id, weekFrom]),
    inMeetingIds(),
    todayAtt(u.id),
    myMeetings(u.id, d),
    setting("work_start", "09:30"),
    setting("work_end", "18:30"),
  ]);

  const status = meetIds.has(u.id) ? "In Meeting" : u.status;
  const taskCounts = {};
  for (const s of ["Assigned", "In Progress", "Submitted", "Approved"]) taskCounts[s] = allTasks.filter((t) => t.status === s).length;
  const weekHours = Math.round(week.reduce((s, a) => s + hoursBetween(a.check_in, a.check_out || (a.date === d ? nowTime() : null)), 0) * 10) / 10;
  res.json({
    user: publicUser(u), attendance, tasks, meetings, status, statuses: STATUSES,
    task_counts: taskCounts, week_hours: weekHours, work_start: workStart, work_end: workEnd, now: nowTime(),
  });
});

app.get("/api/me/team", requireEmployee(), async (req, res) => {
  const u = req.user;
  if (!u.department) return res.json([]);
  const meetIds = await inMeetingIds();
  const team = await rows(
    "SELECT id,name,color,department,designation,status FROM users WHERE role='employee' AND active=1 AND department=? AND id!=? ORDER BY name",
    [u.department, u.id]
  );
  res.json(team.map((e) => ({ ...e, live_status: meetIds.has(e.id) ? "In Meeting" : e.status })));
});

app.post("/api/me/checkin", requireEmployee(), async (req, res) => {
  const g = await needsPerm(req, "attendance.self", "check in");
  if (g) return res.status(403).json(g);
  const u = req.user;
  const a = await todayAtt(u.id);
  if (a && a.check_in) return res.status(400).json({ error: "Already checked in today" });
  const t = nowTime();
  const ws = await setting("work_start", "09:30");
  const grace = parseInt((await setting("late_grace_minutes", "10")) || "0", 10);
  const [h, m] = ws.split(":").map(Number);
  const total = h * 60 + m + grace;
  const limit = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  const st = t > limit ? "Late" : "Present";
  if (a) await execute("UPDATE attendance SET check_in=?, status=? WHERE id=?", [t, st, a.id]);
  else await execute("INSERT INTO attendance(user_id,date,check_in,status) VALUES(?,?,?,?)", [u.id, today(), t, st]);
  await execute("UPDATE users SET status='Available' WHERE id=?", [u.id]);
  await audit(req, "CHECK_IN", `Checked in at ${t} (${st})`);
  res.json({ ok: true, time: t, status: st });
});

app.post("/api/me/checkout", requireEmployee(), async (req, res) => {
  const g = await needsPerm(req, "attendance.self", "check out");
  if (g) return res.status(403).json(g);
  const u = req.user;
  const a = await todayAtt(u.id);
  if (!a || !a.check_in) return res.status(400).json({ error: "You haven't checked in yet" });
  if (a.check_out) return res.status(400).json({ error: "Already checked out today" });
  const t = nowTime();
  await execute("UPDATE breaks SET end_time=? WHERE user_id=? AND date=? AND end_time IS NULL", [t, u.id, today()]);
  await execute("UPDATE attendance SET check_out=? WHERE id=?", [t, a.id]);
  await execute("UPDATE users SET status='Offline' WHERE id=?", [u.id]);
  await audit(req, "CHECK_OUT", `Checked out at ${t}`);
  res.json({ ok: true, time: t });
});

app.post("/api/me/break/:action", requireEmployee(), async (req, res) => {
  const g = await needsPerm(req, "attendance.self", "take breaks");
  if (g) return res.status(403).json(g);
  const u = req.user, action = req.params.action;
  const a = await todayAtt(u.id);
  if (!a || !a.check_in || a.check_out) return res.status(400).json({ error: "You must be checked in to take a break" });
  const t = nowTime();
  const openB = await row("SELECT * FROM breaks WHERE user_id=? AND date=? AND end_time IS NULL", [u.id, today()]);
  if (action === "start") {
    if (openB) return res.status(400).json({ error: "Break already started" });
    await execute("INSERT INTO breaks(user_id,date,start_time) VALUES(?,?,?)", [u.id, today(), t]);
    await execute("UPDATE users SET status='On Break' WHERE id=?", [u.id]);
  } else if (action === "end") {
    if (!openB) return res.status(400).json({ error: "No break in progress" });
    await execute("UPDATE breaks SET end_time=? WHERE id=?", [t, openB.id]);
    await execute("UPDATE users SET status='Available' WHERE id=?", [u.id]);
  } else {
    return res.status(400).json({ error: "Invalid action" });
  }
  await audit(req, `BREAK_${action.toUpperCase()}`, `Break ${action} at ${t}`);
  res.json({ ok: true, time: t });
});

app.put("/api/me/status", requireEmployee(), async (req, res) => {
  const st = (req.body || {}).status;
  if (!STATUSES.includes(st)) return res.status(400).json({ error: "Invalid status" });
  await execute("UPDATE users SET status=? WHERE id=?", [st, req.user.id]);
  await audit(req, "STATUS_CHANGE", `Status set to ${st}`);
  res.json({ ok: true });
});

app.get("/api/me/attendance", requireEmployee(), async (req, res) => {
  const u = req.user;
  const recs = await rows("SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC LIMIT 60", [u.id]);
  for (const r of recs) r.hours = hoursBetween(r.check_in, r.check_out);
  res.json({ today: await todayAtt(u.id), records: recs, now: nowTime() });
});

app.get("/api/me/tasks", requireEmployee(), async (req, res) => {
  res.json(await rows(
    "SELECT t.*, c.name creator, (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=t.id) comment_count, " +
    "(SELECT text FROM task_feedback f WHERE f.task_id=t.id ORDER BY f.id DESC LIMIT 1) last_feedback, " +
    "(SELECT kind FROM task_feedback f WHERE f.task_id=t.id ORDER BY f.id DESC LIMIT 1) last_feedback_kind FROM tasks t LEFT JOIN users c ON c.id=t.created_by " +
    "WHERE t.assigned_to=? ORDER BY CASE t.status WHEN 'Approved' THEN 1 ELSE 0 END, t.due_date",
    [req.user.id]
  ));
});

app.put("/api/me/tasks/:tid", requireEmployee(), async (req, res) => {
  const g = await needsPerm(req, "tasks.work", "work on tasks");
  if (g) return res.status(403).json(g);
  const tid = Number(req.params.tid);
  const t = await row("SELECT * FROM tasks WHERE id=? AND assigned_to=?", [tid, req.user.id]);
  if (!t) return res.status(404).json({ error: "Task not found" });
  const b = req.body || {};
  const st = b.status || t.status;
  const note = ("note" in b ? b.note : t.work_note || "").trim();
  if (!["Assigned", "In Progress", "Submitted"].includes(st)) return res.status(400).json({ error: "Invalid status" });
  if (["Submitted", "Approved"].includes(t.status)) return res.status(400).json({ error: `This task is already ${t.status.toLowerCase()}` });
  if (st === "Submitted" && !note) return res.status(400).json({ error: "Describe the work you did before submitting" });
  await execute("UPDATE tasks SET status=?, work_note=?, completed_at=NULL WHERE id=?", [st, note, tid]);
  if (st !== t.status) {
    const n = (await row("SELECT COUNT(*) c FROM task_attachments WHERE task_id=?", [tid])).c;
    if (st === "Submitted") await logTask(req, tid, "submitted", `submitted the work for review${n ? ` with ${n} file${n !== 1 ? "s" : ""}` : ""}`, note);
    else await logTask(req, tid, "status", `changed status from ${t.status} to ${st}`);
  } else if (note !== (t.work_note || "")) {
    await logTask(req, tid, "note", "updated the work notes", note);
  }
  await audit(req, "TASK_STATUS", `Task #${tid} '${t.title}' -> ${st}`);
  res.json({ ok: true });
});

app.post("/api/me/meetings/:mid/join-request", requireEmployee(), async (req, res) => {
  const g = await needsPerm(req, "meetings.join", "join meetings");
  if (g) return res.status(403).json(g);
  const mid = Number(req.params.mid);
  const u = req.user;
  const m = (await myMeetings(u.id)).find((x) => x.id === mid);
  if (!m || !m.has_link) return res.status(404).json({ error: "Meeting not found" });
  if (m.state === "Completed") return res.status(400).json({ error: "This meeting has ended" });
  if (["pending", "approved"].includes(m.join_status)) return res.status(400).json({ error: `Your request is already ${m.join_status}` });
  await execute("INSERT INTO meeting_join_requests VALUES(?,?,'pending',?) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='pending', ts=EXCLUDED.ts", [mid, u.id, nowTs()]);
  await audit(req, "MEETING_JOIN_REQUEST", `Requested to join '${m.title}'`);
  res.json({ ok: true });
});

app.get("/api/me/meetings", requireEmployee(), async (req, res) => {
  res.json(await myMeetings(req.user.id));
});

app.get("/api/me/reports", requireEmployee(), async (req, res) => {
  const u = req.user;
  const [dFrom, dTo] = reportRange(req);
  const attList = await rows("SELECT * FROM attendance WHERE user_id=? AND date BETWEEN ? AND ?", [u.id, dFrom, dTo]);
  const att = Object.fromEntries(attList.map((a) => [a.date, a]));
  const days = [];
  for (let d = new Date(`${dFrom}T00:00:00`), end = new Date(`${dTo}T00:00:00`); d <= end; d.setDate(d.getDate() + 1)) {
    if (d.getDay() >= 1 && d.getDay() <= 5) {
      const iso = d.toISOString().slice(0, 10);
      const a = att[iso];
      days.push({ label: d.toLocaleDateString("en-US", { day: "2-digit", month: "short" }), value: a ? hoursBetween(a.check_in, a.check_out) : 0, status: a ? a.status : "-" });
    }
  }
  res.json({
    range: { from: dFrom, to: dTo }, summary: await employeeReport(u.id, dFrom, dTo), days,
    records: await attendanceHistory(u.id, dFrom, dTo), completed_tasks: await completedTasks(u.id, dFrom, dTo),
  });
});

app.put("/api/me/profile", requireEmployee(), async (req, res) => {
  const b = req.body || {};
  const fields = {};
  for (const k of ["name", "phone"]) if (typeof b[k] === "string" && b[k].trim()) fields[k] = b[k].trim();
  const keys = Object.keys(fields);
  if (keys.length) {
    await execute(`UPDATE users SET ${keys.map((k) => `${k}=?`).join(", ")} WHERE id=?`, [...keys.map((k) => fields[k]), req.user.id]);
    await audit(req, "PROFILE_UPDATE", `Updated ${keys.join(", ")}`);
  }
  res.json({ ok: true });
});

// ----------------------------------------------------------------- Teamo Meet rooms
// Signalling moved off this server entirely (no more ROOMS dict / long-poll, which can't
// run inside a Netlify Function anyway): WebRTC offer/answer/ICE, mic/cam/hand/sharing
// state and emoji reactions are sent browser-to-browser via Supabase Realtime Presence
// and Broadcast directly (see teamo/frontend/js/meet.js) using the public anon key from
// GET /api/public-config. This server still gates every authority-sensitive action
// (who may open the room, get admitted, force-mute, remove or end the call) exactly like
// room_guard() did in teamo/main.py — only the live roster/signal relay moved client-side.
// Chat is the one thing that still persists to Postgres (room_chat), so it survives
// reconnects; new rows reach other clients via a Realtime subscription on that table.

const ICE_SERVERS = JSON.parse(process.env.TEAMO_ICE_SERVERS || "[]");
const REACTIONS = ["\u{1F44D}", "\u{2764}\u{FE0F}", "\u{1F602}", "\u{1F44F}", "\u{1F389}", "\u{1F62E}", "\u{1F64C}", "\u{1F914}"];

app.get("/api/public-config", (req, res) => {
  res.json({ supabase_url: process.env.SUPABASE_URL, supabase_anon_key: process.env.SUPABASE_ANON_KEY });
});

// (meeting, user, is_host, access) -- access is approved | pending | denied | none | closed | null
async function roomAccess(code, req) {
  const u = req.user;
  const m = await row("SELECT * FROM meetings WHERE room_code=? AND room_code!=''", [code]);
  if (!u || !m) return { m: null, u, host: false, access: null };
  if (["admin", "manager"].includes(u.role) && (await userPerms(u)).includes("meetings.manage")) {
    return { m, u, host: true, access: "approved" };
  }
  if (!(await row("SELECT 1 FROM meeting_participants WHERE meeting_id=? AND user_id=?", [m.id, u.id]))) {
    return { m: null, u, host: false, access: null };
  }
  if (m.date !== today()) return { m, u, host: false, access: "closed" };
  const r = await row("SELECT status FROM meeting_join_requests WHERE meeting_id=? AND user_id=?", [m.id, u.id]);
  return { m, u, host: false, access: r ? r.status : "none" };
}

async function roomGuard(code, req, needApproved = true) {
  const { m, u, host, access } = await roomAccess(code, req);
  if (!u) return { error: [401, { error: "Not logged in" }] };
  if (!m) return { error: [404, { error: "Meeting room not found" }] };
  if (needApproved && access !== "approved") return { error: [403, { error: "The host hasn't admitted you yet" }] };
  return { ctx: { m, u, host } };
}

const toChatMsg = (c) => ({ id: c.id, name: c.name, user_id: c.user_id, text: c.text, time: (c.ts || "").slice(11, 16) });

app.get("/api/rooms/:code/info", requireLogin(), async (req, res) => {
  const { m, u, host, access } = await roomAccess(req.params.code, req);
  if (!m) return res.status(404).json({ error: "Meeting room not found" });
  res.json({
    title: m.title, description: m.description, date: m.date, start: m.start_time, end: m.end_time,
    host, access, state: meetingState(m), me: { id: u.id, name: u.name, color: u.color, role: u.role }, ice: ICE_SERVERS,
  });
});

app.post("/api/rooms/:code/request", requireLogin(), async (req, res) => {
  const { m, u, access } = await roomAccess(req.params.code, req);
  if (!m) return res.status(404).json({ error: "Meeting room not found" });
  if (access === "none" || access === "denied") {
    await execute("INSERT INTO meeting_join_requests VALUES(?,?,'pending',?) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='pending', ts=EXCLUDED.ts", [m.id, u.id, nowTs()]);
    await audit(req, "MEETING_JOIN_REQUEST", `Requested to join '${m.title}'`);
  }
  res.json({ ok: true });
});

// Host-only: who's waiting in the lobby. Polled every few seconds client-side (cheap,
// stateless) rather than pushed over Realtime — admission is infrequent enough that
// a short poll is simpler than wiring RLS for meeting_join_requests.
app.get("/api/rooms/:code/lobby", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { m, host } = g.ctx;
  if (!host) return res.json([]);
  res.json(await rows(
    "SELECT r.user_id,u.name,u.color FROM meeting_join_requests r JOIN users u ON u.id=r.user_id WHERE r.meeting_id=? AND r.status='pending' ORDER BY r.ts",
    [m.id]
  ));
});

app.post("/api/rooms/:code/join", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { m, u, host } = g.ctx;
  if (m.ended_early) {
    if (!host) return res.status(410).json({ error: "The host ended this meeting" });
    await execute("UPDATE meetings SET ended_early=0 WHERE id=?", [m.id]); // host restarted the call; it's back in progress
  }
  const peer = crypto.randomBytes(6).toString("hex");
  const history = (await rows("SELECT * FROM room_chat WHERE room_code=? ORDER BY id DESC LIMIT 50", [req.params.code])).reverse();
  await markInMeeting(u.id, true); // they're actually in the call now, so show it on the dashboards
  await audit(req, "MEETING_ROOM_JOIN", `Joined room for '${m.title}'`);
  res.json({ peer, chat_since: history.length ? history[history.length - 1].id : 0, history: history.map(toChatMsg) });
});

app.post("/api/rooms/:code/chat", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { u } = g.ctx;
  const text = ((req.body || {}).text || "").trim().slice(0, 1000);
  if (!text) return res.status(400).json({ error: "Write a message first" });
  // Persisted row reaches other clients via their Realtime subscription on room_chat.
  await execute("INSERT INTO room_chat(room_code,user_id,name,text,ts) VALUES(?,?,?,?,?)", [req.params.code, u.id, u.name, text, nowTs()]);
  res.json({ ok: true });
});

app.post("/api/rooms/:code/react", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { u } = g.ctx;
  const emoji = (req.body || {}).emoji;
  if (!REACTIONS.includes(emoji)) return res.status(400).json({ error: "Invalid reaction" });
  await broadcast(req.params.code, "reaction", { user_id: u.id, name: u.name, emoji });
  res.json({ ok: true });
});

app.post("/api/rooms/:code/mic/:peer", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { m, host } = g.ctx;
  if (!host) return res.status(403).json({ error: "Only the host can do that" });
  const on = !!(req.body || {}).on;
  await broadcast(req.params.code, "force-mic", { peer: req.params.peer, on });
  await audit(req, "MEETING_ROOM_MIC", `${on ? "Unmuted" : "Muted"} a participant in '${m.title}'`);
  res.json({ ok: true });
});

app.post("/api/rooms/:code/remove/:peer", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { m, host } = g.ctx;
  if (!host) return res.status(403).json({ error: "Only the host can do that" });
  const targetUserId = Number((req.body || {}).user_id) || 0;
  if (targetUserId) await execute("UPDATE meeting_join_requests SET status='denied' WHERE meeting_id=? AND user_id=?", [m.id, targetUserId]);
  await broadcast(req.params.code, "removed", { peer: req.params.peer });
  await audit(req, "MEETING_ROOM_REMOVE", `Removed a participant from '${m.title}'`);
  res.json({ ok: true });
});

// Self-reported (no host check needed): only ever clears the caller's own live status.
app.post("/api/rooms/:code/leave", requireLogin(), async (req, res) => {
  await markInMeeting(req.user.id, false);
  res.json({ ok: true });
});

app.post("/api/rooms/:code/end", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { m, host } = g.ctx;
  if (!host) return res.status(403).json({ error: "Only the host can end the meeting" });
  await execute("UPDATE meetings SET ended_early=1 WHERE id=?", [m.id]); // so the dashboard stops showing it as in progress
  await broadcast(req.params.code, "ended", {});
  await audit(req, "MEETING_ROOM_END", `Ended room for '${m.title}'`);
  res.json({ ok: true });
});

app.post("/api/rooms/:code/admit", requireLogin(), async (req, res) => {
  const g = await roomGuard(req.params.code, req);
  if (g.error) return res.status(g.error[0]).json(g.error[1]);
  const { m, host } = g.ctx;
  if (!host) return res.status(403).json({ error: "Only the host can admit people" });
  const b = req.body || {};
  const status = b.decision === "approve" ? "approved" : "denied";
  await execute("UPDATE meeting_join_requests SET status=? WHERE meeting_id=? AND user_id=?", [status, m.id, Number(b.user_id) || 0]);
  res.json({ ok: true });
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    const msg = err.code === "LIMIT_FILE_SIZE" ? `A file is larger than ${MAX_FILE_MB} MB`
      : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `Attach up to ${MAX_FILES} files at a time`
      : "Upload failed";
    return res.status(400).json({ error: msg });
  }
  next(err);
});

// Catches anything else thrown/rejected by a route (the async-handler wrapper above turns
// a rejected promise into this, instead of an unhandled rejection that crashes the function).
// Logged server-side (visible in Netlify's function logs) so it's diagnosable without
// leaking internals to the client.
app.use((err, req, res, next) => {
  console.error("Unhandled error in", req.method, req.path, err);
  res.status(500).json({ error: "Something went wrong on our end. Try again in a moment." });
});

app.use((req, res) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  res.redirect("/");
});

module.exports = app;

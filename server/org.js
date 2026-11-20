// Employee directory, organization chart and team management.
//
// Reporting lines live in users.reports_to (admin -> manager -> team lead -> employee). A "team
// lead" is whoever teams.lead_id points at, not a separate role, so the account roles and the
// permission system stay as they were. Contact details (email, phone, address, gender) are only
// ever sent to the person themselves or to staff who hold employees.view; everybody else gets the
// professional profile only.
const { pool, row, rows, execute } = require("./db");
const { requireLogin, userPerms } = require("./auth");
const { audit, nowTs, nowTime, today, inMeetingIds } = require("./util");

const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const rank = (p) => (p.role === "admin" ? 0 : p.role === "manager" ? 1 : p.is_lead ? 2 : 3);

// any signed-in user holding `perm` (the permission table decides, per role)
// One query resolves both the signed-in user and what their role may do (two sequential round trips to
// the database used to cost ~0.4s on every request).
const need = (perm) => async (req, res, next) => {
  const uid = req.sessionData[`uid_${req.portal}`];
  const found = uid ? (await pool.query(
    "SELECT u.*, COALESCE((SELECT array_agg(p.perm) FROM permissions p WHERE p.role=u.role AND p.allowed=1), '{}') AS perm_list FROM users u WHERE u.id=$1 AND u.active=1", [uid]
  )).rows[0] : null;
  if (!found) return res.status(401).json({ error: "Not logged in" });
  req.perms = found.perm_list;
  delete found.perm_list;
  req.user = found;
  if (!req.perms.includes(perm)) return res.status(403).json({ error: "You don't have permission to do that" });
  next();
};

module.exports = function mount(app) {
  // ---- shared loaders -------------------------------------------------------------------------
  async function loadAll() {
    const [users, teams, members, tasks, inMeet] = await Promise.all([
      rows("SELECT id,name,email,personal_email,phone,address,gender,role,department,designation,status,color,photo,reports_to,joined FROM users WHERE approval='approved' AND active=1 ORDER BY name"),
      rows("SELECT t.*, d.name department FROM teams t LEFT JOIN departments d ON d.id=t.department_id ORDER BY t.name"),
      rows("SELECT * FROM team_members"),
      rows("SELECT assigned_to uid, project, status, COUNT(*) n FROM tasks WHERE assigned_to IS NOT NULL GROUP BY assigned_to, project, status"),
      inMeetingIds(),
    ]);
    const byId = new Map(users.map((u) => [u.id, u]));
    for (const u of users) { u.teams = []; u.projects = new Map(); u.live_status = inMeet.has(u.id) ? "In Meeting" : u.status; u.is_lead = false; u.photo = u.photo || ""; }
    const teamById = new Map(teams.map((t) => [t.id, { ...t, members: [] }]));
    for (const m of members) {
      const u = byId.get(m.user_id), t = teamById.get(m.team_id);
      if (u && t) { t.members.push(u.id); u.teams.push({ id: t.id, name: t.name, lead_id: t.lead_id }); }
    }
    for (const t of teamById.values()) { const l = byId.get(t.lead_id); if (l) l.is_lead = true; }
    for (const r of tasks) {
      const u = byId.get(r.uid);
      if (!u || !r.project) continue;
      const p = u.projects.get(r.project) || { name: r.project, open: 0, done: 0 };
      if (r.status === "Approved") p.done += r.n; else p.open += r.n;
      u.projects.set(r.project, p);
    }
    for (const u of users) u.projects = [...u.projects.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name));
    return { users, byId, teams: [...teamById.values()] };
  }

  const canSeeContact = (req, perms, target) =>
    req.user.id === target.id || (["admin", "manager"].includes(req.user.role) && perms.includes("employees.view") && !(req.user.role === "manager" && target.role === "admin"));
  const brief = (u) => u && ({ id: u.id, name: u.name, role: u.role, designation: u.designation, department: u.department, color: u.color, photo: u.photo, live_status: u.live_status, is_lead: u.is_lead });
  const professional = (u, byId) => ({
    ...brief(u), teams: u.teams.map((t) => t.name), projects: u.projects,
    reports_to: u.reports_to && byId.has(u.reports_to) ? brief(byId.get(u.reports_to)) : null,
  });

  // ---- directory ------------------------------------------------------------------------------
  app.get("/api/org/directory", need("directory.view"), async (req, res) => {
    const { users, byId } = await loadAll();
    res.json(users.map((u) => professional(u, byId)));
  });

  // Everything on one person's profile in a single database round trip (JSON built in SQL).
  const BRIEF = "id,name,role,designation,department,color,photo,status";
  app.get("/api/org/people/:id", need("directory.view"), async (req, res) => {
    const uid = Number(req.params.id);
    if (!Number.isInteger(uid)) return res.status(404).json({ error: "Person not found" });
    const t = nowTime();
    const { rows: [r] } = await pool.query(`SELECT json_build_object(
      'person', (SELECT row_to_json(x) FROM (SELECT ${BRIEF},reports_to,joined,email,personal_email,phone,address,gender FROM users WHERE id=$1 AND approval='approved' AND active=1) x),
      'boss', (SELECT row_to_json(x) FROM (SELECT b.id,b.name,b.role,b.designation,b.department,b.color,b.photo,b.status FROM users u JOIN users b ON b.id=u.reports_to WHERE u.id=$1 AND b.active=1) x),
      'reports', (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT r.id,r.name,r.role,r.designation,r.department,r.color,r.photo,r.status,
          (SELECT COALESCE(json_agg(DISTINCT k.project),'[]'::json) FROM tasks k WHERE k.assigned_to=r.id AND k.status<>'Approved' AND k.project<>'') projects
          FROM users r WHERE r.reports_to=$1 AND r.approval='approved' AND r.active=1 ORDER BY r.name) x),
      'teams', (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT tm.id,tm.name,tm.lead_id,d.name department,
          (SELECT COUNT(*)::int FROM team_members m2 WHERE m2.team_id=tm.id) size,
          l.name lead_name,l.designation lead_designation,l.color lead_color,l.photo lead_photo,l.role lead_role
          FROM teams tm LEFT JOIN departments d ON d.id=tm.department_id LEFT JOIN users l ON l.id=tm.lead_id
          WHERE tm.id IN (SELECT team_id FROM team_members WHERE user_id=$1) OR tm.lead_id=$1 ORDER BY tm.name) x),
      'tasks', (SELECT COALESCE(json_agg(x),'[]'::json) FROM (SELECT project,status,COUNT(*)::int n FROM tasks WHERE assigned_to=$1 GROUP BY project,status) x),
      'att', (SELECT row_to_json(x) FROM (SELECT check_in,check_out,status FROM attendance WHERE user_id=$1 AND date=$2) x),
      'in_meeting', EXISTS(SELECT 1 FROM meetings m JOIN meeting_participants mp ON mp.meeting_id=m.id WHERE mp.user_id=$1 AND m.date=$2 AND m.start_time<=$3 AND m.end_time>$3 AND m.ended_early=0)
    ) AS j`, [uid, today(), t]);
    const j = r.j, u = j.person;
    if (!u) return res.status(404).json({ error: "Person not found" });
    const led = j.teams.filter((x) => x.lead_id === uid);
    const lead = (x) => (x.lead_id ? { id: x.lead_id, name: x.lead_name, role: x.lead_role, designation: x.lead_designation, color: x.lead_color, photo: x.lead_photo || "", is_lead: true } : null);
    const projects = new Map();
    for (const k of j.tasks) {
      if (!k.project) continue;
      const p = projects.get(k.project) || { name: k.project, open: 0, done: 0 };
      if (k.status === "Approved") p.done += k.n; else p.open += k.n;
      projects.set(k.project, p);
    }
    const tc = { Assigned: 0, "In Progress": 0, Submitted: 0, Approved: 0 };
    for (const k of j.tasks) tc[k.status] = (tc[k.status] || 0) + k.n;
    const live = j.in_meeting || u.status === "In Meeting" ? "In Meeting" : u.status;
    const out = {
      id: u.id, name: u.name, role: u.role, designation: u.designation, department: u.department, color: u.color, photo: u.photo || "",
      live_status: live, is_lead: led.length > 0, joined: u.joined,
      reports_to: j.boss ? { ...j.boss, photo: j.boss.photo || "", live_status: j.boss.status } : null,
      projects: [...projects.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
      reports: j.reports.map((x) => ({ ...x, photo: x.photo || "", live_status: x.status, projects: x.projects })),
      teams: j.teams.map((x) => ({ id: x.id, name: x.name, department: x.department || "", lead: lead(x), size: x.size, you_lead: x.lead_id === uid })),
      led_teams: led.map((x) => ({ id: x.id, name: x.name, size: x.size })),
      work: { status: live, login_time: j.att ? j.att.check_in : null, logout_time: j.att ? j.att.check_out : null, today: j.att ? j.att.status : "Not marked", tasks: tc },
    };
    if (canSeeContact(req, req.perms, u)) out.contact = { email: u.email, personal_email: u.personal_email, phone: u.phone, address: u.address, gender: u.gender };
    res.json(out);
  });

  // ---- organization chart ---------------------------------------------------------------------
  app.get("/api/org/chart", need("directory.view"), async (req, res) => {
    const { users, byId } = await loadAll();
    res.json(users.map((u) => ({ ...brief(u), parent: u.reports_to && byId.has(u.reports_to) ? u.reports_to : null, rank: rank(u), team_count: u.teams.length })));
  });

  // ---- teams (everyone with directory access can read) ----------------------------------------
  app.get("/api/org/teams", need("directory.view"), async (req, res) => {
    const { users, byId, teams } = await loadAll();
    const depts = await rows("SELECT * FROM departments ORDER BY name");
    const card = (t) => ({
      id: t.id, name: t.name, department_id: t.department_id, lead: brief(byId.get(t.lead_id)) || null,
      members: t.members.map((id) => brief(byId.get(id))).sort((a, b) => (b.id === t.lead_id) - (a.id === t.lead_id) || a.name.localeCompare(b.name)),
    });
    const groups = depts.map((d) => ({ id: d.id, name: d.name, head: brief(byId.get(d.head_id)) || null, teams: teams.filter((t) => t.department_id === d.id).map(card) }));
    const loose = teams.filter((t) => !depts.some((d) => d.id === t.department_id));
    if (loose.length) groups.push({ id: null, name: "No department", head: null, teams: loose.map(card) });
    res.json({ departments: groups, people: req.perms.includes("teams.manage") ? users.map((u) => ({ ...brief(u), reports_to: u.reports_to && byId.has(u.reports_to) ? u.reports_to : null })) : [] });
  });

  // ---- management (teams.manage) --------------------------------------------------------------
  const manage = need("teams.manage");
  const name80 = (v) => String(v || "").trim().slice(0, 80);
  const id = (v) => (v === "" || v == null ? null : Number(v));

  async function personOk(uid) { return !!(await row("SELECT id FROM users WHERE id=? AND approval='approved' AND active=1", [uid])); }
  async function deptHead(deptId) { return deptId ? (await row("SELECT head_id FROM departments WHERE id=?", [deptId]))?.head_id || null : null; }
  async function wouldLoop(uid, parent) { // would making `parent` the boss of `uid` create a cycle?
    for (let p = parent, n = 0; p && n < 200; n++) {
      if (p === uid) return true;
      p = (await row("SELECT reports_to FROM users WHERE id=?", [p]))?.reports_to || null;
    }
    return false;
  }

  // points the team at a new lead and keeps the reporting lines in step
  async function setLead(team, newLead) {
    const old = team.lead_id || null;
    if (old === newLead) return;
    await execute("UPDATE teams SET lead_id=? WHERE id=?", [newLead, team.id]);
    const memberIds = (await rows("SELECT user_id FROM team_members WHERE team_id=?", [team.id])).map((m) => m.user_id);
    if (newLead) {
      await execute("INSERT INTO team_members(team_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING", [team.id, newLead]);
      for (const uid of memberIds) if (uid !== newLead && !(await wouldLoop(uid, newLead))) await execute("UPDATE users SET reports_to=? WHERE id=?", [newLead, uid]);
      const boss = await row("SELECT reports_to FROM users WHERE id=?", [newLead]);
      if (!boss.reports_to || boss.reports_to === old || memberIds.includes(boss.reports_to)) {
        const head = await deptHead(team.department_id);
        await execute("UPDATE users SET reports_to=? WHERE id=?", [head && head !== newLead ? head : null, newLead]);
      }
    } else if (old) {
      await execute("UPDATE users SET reports_to=NULL WHERE reports_to=? AND id IN (SELECT user_id FROM team_members WHERE team_id=?)", [old, team.id]);
    }
  }

  app.post("/api/org/departments", manage, async (req, res) => {
    const name = name80(req.body.name), head = id(req.body.head_id);
    if (!name) return res.status(400).json({ error: "Department name is required" });
    if (await row("SELECT id FROM departments WHERE lower(name)=lower(?)", [name])) return res.status(400).json({ error: "That department already exists" });
    if (head && !(await personOk(head))) return res.status(400).json({ error: "Pick a valid department head" });
    const did = await execute("INSERT INTO departments(name,head_id,created_at) VALUES(?,?,?)", [name, head, nowTs()]);
    await audit(req, "DEPARTMENT_CREATE", `Created department ${name}`);
    res.json({ ok: true, id: did });
  });

  app.put("/api/org/departments/:id", manage, async (req, res) => {
    const d = await row("SELECT * FROM departments WHERE id=?", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Department not found" });
    const b = req.body || {};
    const name = "name" in b ? name80(b.name) : d.name, head = "head_id" in b ? id(b.head_id) : d.head_id;
    if (!name) return res.status(400).json({ error: "Department name is required" });
    if (await row("SELECT id FROM departments WHERE lower(name)=lower(?) AND id!=?", [name, d.id])) return res.status(400).json({ error: "That department already exists" });
    if (head && !(await personOk(head))) return res.status(400).json({ error: "Pick a valid department head" });
    await execute("UPDATE departments SET name=?, head_id=? WHERE id=?", [name, head, d.id]);
    if (name !== d.name) await execute("UPDATE users SET department=? WHERE department=?", [name, d.name]);
    await audit(req, "DEPARTMENT_UPDATE", `Updated department ${d.name}`);
    res.json({ ok: true });
  });

  app.delete("/api/org/departments/:id", manage, async (req, res) => {
    const d = await row("SELECT * FROM departments WHERE id=?", [req.params.id]);
    if (!d) return res.status(404).json({ error: "Department not found" });
    if (await row("SELECT id FROM teams WHERE department_id=?", [d.id])) return res.status(400).json({ error: "Move or delete this department's teams first" });
    await execute("DELETE FROM departments WHERE id=?", [d.id]);
    await audit(req, "DEPARTMENT_DELETE", `Deleted department ${d.name}`);
    res.json({ ok: true });
  });

  app.post("/api/org/teams", manage, async (req, res) => {
    const b = req.body || {}, name = name80(b.name), dept = id(b.department_id), lead = id(b.lead_id);
    if (!name) return res.status(400).json({ error: "Team name is required" });
    if (dept && !(await row("SELECT id FROM departments WHERE id=?", [dept]))) return res.status(400).json({ error: "Department not found" });
    if (await row("SELECT id FROM teams WHERE lower(name)=lower(?) AND department_id IS NOT DISTINCT FROM ?", [name, dept])) return res.status(400).json({ error: "That team already exists in this department" });
    if (lead && !(await personOk(lead))) return res.status(400).json({ error: "Pick a valid team lead" });
    const tid = await execute("INSERT INTO teams(name,department_id,created_at) VALUES(?,?,?)", [name, dept, nowTs()]);
    if (lead) await setLead({ id: tid, lead_id: null, department_id: dept }, lead);
    await audit(req, "TEAM_CREATE", `Created team ${name}`);
    res.json({ ok: true, id: tid });
  });

  app.put("/api/org/teams/:id", manage, async (req, res) => {
    const t = await row("SELECT * FROM teams WHERE id=?", [req.params.id]);
    if (!t) return res.status(404).json({ error: "Team not found" });
    const b = req.body || {};
    const name = "name" in b ? name80(b.name) : t.name, dept = "department_id" in b ? id(b.department_id) : t.department_id;
    if (!name) return res.status(400).json({ error: "Team name is required" });
    if (dept && !(await row("SELECT id FROM departments WHERE id=?", [dept]))) return res.status(400).json({ error: "Department not found" });
    if ("lead_id" in b && id(b.lead_id) && !(await personOk(id(b.lead_id)))) return res.status(400).json({ error: "Pick a valid team lead" });
    await execute("UPDATE teams SET name=?, department_id=? WHERE id=?", [name, dept, t.id]);
    if ("lead_id" in b) await setLead({ ...t, department_id: dept }, id(b.lead_id));
    await audit(req, "TEAM_UPDATE", `Updated team ${t.name}`);
    res.json({ ok: true });
  });

  app.delete("/api/org/teams/:id", manage, async (req, res) => {
    const t = await row("SELECT * FROM teams WHERE id=?", [req.params.id]);
    if (!t) return res.status(404).json({ error: "Team not found" });
    await setLead(t, null);
    await execute("DELETE FROM team_members WHERE team_id=?", [t.id]);
    await execute("DELETE FROM teams WHERE id=?", [t.id]);
    await audit(req, "TEAM_DELETE", `Deleted team ${t.name}`);
    res.json({ ok: true });
  });

  app.post("/api/org/teams/:id/members", manage, async (req, res) => {
    const t = await row("SELECT t.*, d.name dname FROM teams t LEFT JOIN departments d ON d.id=t.department_id WHERE t.id=?", [req.params.id]);
    if (!t) return res.status(404).json({ error: "Team not found" });
    const uid = id(req.body.user_id), u = uid && await row("SELECT * FROM users WHERE id=? AND approval='approved' AND active=1", [uid]);
    if (!u) return res.status(400).json({ error: "Pick a valid person" });
    await execute("INSERT INTO team_members(team_id,user_id) VALUES(?,?) ON CONFLICT DO NOTHING", [t.id, u.id]);
    if (t.lead_id && t.lead_id !== u.id && !(await wouldLoop(u.id, t.lead_id))) await execute("UPDATE users SET reports_to=? WHERE id=?", [t.lead_id, u.id]);
    if (t.dname && !u.department) await execute("UPDATE users SET department=? WHERE id=?", [t.dname, u.id]);
    await audit(req, "TEAM_MEMBER_ADD", `Added ${u.name} to team ${t.name}`);
    res.json({ ok: true });
  });

  app.delete("/api/org/teams/:id/members/:uid", manage, async (req, res) => {
    const t = await row("SELECT * FROM teams WHERE id=?", [req.params.id]), uid = Number(req.params.uid);
    if (!t) return res.status(404).json({ error: "Team not found" });
    const u = await row("SELECT id,name,reports_to FROM users WHERE id=?", [uid]);
    if (t.lead_id === uid) await setLead(t, null);
    await execute("DELETE FROM team_members WHERE team_id=? AND user_id=?", [t.id, uid]);
    if (u && t.lead_id && u.reports_to === t.lead_id) await execute("UPDATE users SET reports_to=NULL WHERE id=?", [uid]);
    await audit(req, "TEAM_MEMBER_REMOVE", `Removed ${u ? u.name : uid} from team ${t.name}`);
    res.json({ ok: true });
  });

  app.put("/api/org/reporting/:uid", manage, async (req, res) => {
    const uid = Number(req.params.uid), boss = id(req.body.reports_to);
    const u = await row("SELECT id,name FROM users WHERE id=? AND approval='approved' AND active=1", [uid]);
    if (!u) return res.status(404).json({ error: "Person not found" });
    if (boss) {
      if (boss === uid) return res.status(400).json({ error: "Someone can't report to themselves" });
      if (!(await personOk(boss))) return res.status(400).json({ error: "Pick a valid manager" });
      if (await wouldLoop(uid, boss)) return res.status(400).json({ error: "That would create a reporting loop" });
    }
    await execute("UPDATE users SET reports_to=? WHERE id=?", [boss, uid]);
    await audit(req, "REPORTING_UPDATE", `Set reporting line for ${u.name}`);
    res.json({ ok: true });
  });

  // ---- profile photo --------------------------------------------------------------------------
  app.put("/api/org/photo/:uid", requireLogin(), async (req, res) => {
    const uid = Number(req.params.uid), photo = String((req.body || {}).photo || "");
    if (uid !== req.user.id) {
      const perms = await userPerms(req.user);
      if (!["admin", "manager"].includes(req.user.role) || !perms.includes("employees.manage")) return res.status(403).json({ error: "You can only change your own photo" });
    }
    if (photo && (photo.length > 60000 || !PHOTO_RE.test(photo))) return res.status(400).json({ error: "Photo must be a small JPEG" });
    await execute("UPDATE users SET photo=? WHERE id=?", [photo, uid]);
    await audit(req, "PHOTO_UPDATE", photo ? "Updated profile photo" : "Removed profile photo");
    res.json({ ok: true });
  });
};

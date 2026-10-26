/* Teamo – Admin / Manager panel */
let ME, EMPLOYEES = [];
const loadEmployees = async () => {
  if (ME.perms.includes("employees.view")) EMPLOYEES = (await T.api("/api/employees")).filter((u) => u.role === "employee" && u.active);
  return EMPLOYEES;
};
const empOptions = (sel) => [["", "— Unassigned —"], ...EMPLOYEES.map((e) => [e.id, e.name])];
const can = (p) => ME.perms.includes(p);

const V = {};

/* ---------------- Dashboard ---------------- */
V.dashboard = async (el) => {
  const d = await T.api("/api/admin/dashboard");
  const hour = T.now().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const rate = d.total ? Math.round((d.present / d.total) * 100) : 0;
  el.innerHTML = `<div>
    <div class="card hero"><div class="row between wrap">
      <div><h2>${greet}, ${T.esc(ME.user.name.split(" ")[0])} 👋</h2>
      <p>${d.present} of ${d.total} team members are working today · ${d.in_meeting} in meetings right now · ${d.overdue} overdue task${d.overdue === 1 ? "" : "s"}</p></div>
      <div class="row">${can("tasks.manage") ? `<a class="btn" href="#tasks" style="background:rgba(255,255,255,.15);color:#fff;border-color:rgba(255,255,255,.25)">${T.icon("plus")}New task</a>` : ""}
      ${can("meetings.manage") ? `<a class="btn" href="#meetings" style="background:#fff;color:#4f46e5;border:none">${T.icon("video")}Schedule meeting</a>` : ""}</div>
    </div></div>

    <div class="grid g-3 mt">
      ${T.stat("Total Employees", d.total, "users", "indigo", `${d.departments.length} departments`)}
      ${T.stat("Present Today", d.present, "check", "green", `<b style="color:var(--green)">${rate}%</b> attendance · ${d.late} late`)}
      ${T.stat("In Meeting", d.in_meeting, "video", "pink", `${d.meetings_today.length} meetings scheduled today`)}
    </div>

    <div class="grid g-21 mt">
      <div class="card"><div class="card-h"><h3>Attendance – last 7 days</h3><span class="hint">Employees present</span></div>${T.bars(d.week)}</div>
      <div class="card"><div class="card-h"><h3>Task overview</h3></div>
        ${T.donut([{ label: "Assigned", value: d.task_stats.Assigned, color: "#f59e0b" }, { label: "In Progress", value: d.task_stats["In Progress"], color: "#3b82f6" }, { label: "Submitted", value: d.task_stats.Submitted, color: "#8b5cf6" }, { label: "Approved", value: d.task_stats.Approved, color: "#10b981" }], "Tasks")}</div>
    </div>

    <div class="grid g-21 mt">
      <div class="card"><div class="card-h"><h3>Live team status</h3><span class="hint row" style="gap:6px"><span class="live-dot"></span>Auto-refreshing</span></div>
        <div class="table-wrap"><table><thead><tr><th>Employee</th><th>Department</th><th>Check-in</th><th>Status</th></tr></thead><tbody>
        ${d.live.map((e) => `<tr><td>${T.person(e)}</td><td class="muted">${T.esc(e.department)}</td><td>${T.fmtTime(e.check_in)}</td><td>${T.statusBadge(e.live_status)}</td></tr>`).join("")}
        </tbody></table></div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="card-h"><h3>Today's meetings</h3><a class="hint" href="#meetings">View all</a></div>
          <div class="list">${d.meetings_today.length ? d.meetings_today.map((m) => `<div class="li"><div class="time-chip">${T.fmtTime(m.start_time).replace(" ", "<small>")}</small></div>
          <div class="grow"><div class="t">${T.esc(m.title)}</div><div class="s">${T.icon("pin", "i")} ${T.where(m.location, m.state === "Completed")} · ${m.participants} people</div></div></div>`).join("") : `<div class="muted">No meetings today</div>`}</div></div>
        <div class="card"><div class="card-h"><h3>Departments</h3></div><div class="hbar">
          ${d.departments.map((x) => `<div class="r"><span>${T.esc(x.label)}</span><div class="progress"><i style="width:${(x.value / d.total) * 100}%"></i></div><span>${x.value}</span></div>`).join("")}</div></div>
      </div>
    </div>

    <div class="grid mt">
      <div class="card"><div class="card-h"><h3>Priority tasks</h3><a class="hint" href="#tasks">Manage</a></div><div class="list">
        ${d.top_tasks.map((t) => `<div class="li"><div class="grow"><div class="t">${T.esc(t.title)}</div><div class="s">${T.esc(t.assignee || "Unassigned")} · due ${T.fmtDate(t.due_date)}</div></div>${T.badge(t.priority)}${T.badge(t.status)}</div>`).join("") || '<div class="muted">All caught up 🎉</div>'}</div></div>
    </div></div>`;
};

/* ---------------- Employees ---------------- */
const employeeForm = (u = {}) => `<div class="form-grid">
  ${T.field("Full name", "name", u.name)}${T.field("Email", "email", u.email, "email")}
  ${T.field(u.id ? "New password (optional)" : "Password", "password", "", "password")}
  ${T.select("Role", "role", ME.user.role === "admin" ? ["employee", "manager", "admin"] : ["employee", "manager"], u.role || "employee")}
  ${T.field("Department", "department", u.department)}${T.field("Designation", "designation", u.designation)}
  ${T.field("Phone", "phone", u.phone)}${T.select("Gender", "gender", [["", "—"], "Male", "Female", "Other"], u.gender || "")}
  ${T.field("Address", "address", u.address, "textarea", "full")}${T.field("Joining date", "joined", u.joined || T.today(), "date")}
  ${u.id ? T.select("Account", "active", [["1", "Active"], ["0", "Inactive"]], u.active) : ""}</div>`;

V.employees = async (el) => {
  const all = await T.api("/api/employees");
  const pending = can("employees.manage") ? await T.api("/api/registrations") : [];
  let q = "", role = "";
  el.innerHTML = `<div>${pending.length ? `<div class="card" style="margin-bottom:20px;border-color:var(--amber, #f59e0b)"><div class="card-h"><h3>Pending approvals</h3><span class="badge b-amber">${pending.length} waiting</span></div>
    ${pending.map((p) => `<div class="row between" style="gap:12px;padding:10px 0;border-top:1px solid var(--border);flex-wrap:wrap"><div style="min-width:0"><div class="bold">${T.esc(p.name)}</div>
      <div class="small muted">${T.esc(p.email)} · ${T.esc(p.phone || "no phone")}${p.gender ? " · " + T.esc(p.gender) : ""} · registered ${T.fmtDate(p.joined)}</div>
      ${p.address ? `<div class="small muted" style="white-space:pre-wrap;word-break:break-word">${T.icon("pin")} ${T.esc(p.address)}</div>` : ""}</div>
      <div class="row" style="gap:8px"><button class="btn btn-sm success" data-reg="${p.id}:approve">Approve</button><button class="btn btn-sm" data-reg="${p.id}:reject">Reject</button></div></div>`).join("")}</div>` : ""}<div class="toolbar"><div class="search">${T.icon("search")}<input class="input" id="q" placeholder="Search name, email, department"></div>
    <div class="tabs" id="roleTabs">${["", "employee", "manager", "admin"].map((r) => `<button data-r="${r}" class="${r === "" ? "on" : ""}">${r ? r[0].toUpperCase() + r.slice(1) + "s" : "All"}</button>`).join("")}</div>
    <div class="grow"></div>${can("employees.manage") ? `<button class="btn primary" id="add">${T.icon("plus")}Add employee</button>` : ""}</div>
    <div class="card"><div class="card-h"><h3>Team directory</h3><span class="hint" id="cnt"></span></div><div class="table-wrap"><table>
    <thead><tr><th>Employee</th><th>Email</th><th>Department</th><th>Role</th><th>Status</th><th>Joined</th><th>Account</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div></div>`;
  const draw = () => {
    const list = all.filter((u) => (!role || u.role === role) && `${u.name} ${u.email} ${u.department} ${u.designation}`.toLowerCase().includes(q));
    el.querySelector("#cnt").textContent = `${list.length} people`;
    el.querySelector("#tb").innerHTML = list.map((u) => `<tr data-row="${u.id}" style="cursor:pointer"><td>${T.person(u)}</td><td class="muted">${T.esc(u.email)}</td><td>${T.esc(u.department)}</td>
      <td>${T.badge(u.role)}</td><td>${u.role === "employee" ? T.statusBadge(u.status) : "—"}</td><td class="muted">${T.fmtDate(u.joined)}</td><td>${T.badge(u.active ? "Active" : "Inactive")}</td>
      <td>${can("employees.manage") ? `<div class="actions"><button class="btn btn-ghost" data-e="${u.id}" title="Edit">${T.icon("edit")}</button><button class="btn btn-ghost del" data-d="${u.id}" title="Delete">${T.icon("trash")}</button></div>` : ""}</td></tr>`).join("")
      || `<tr><td colspan="8" class="empty">No matching people</td></tr>`;
  };
  draw();
  el.querySelector("#q").oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  el.querySelectorAll("#roleTabs button").forEach((b) => (b.onclick = () => { role = b.dataset.r; el.querySelectorAll("#roleTabs button").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  el.querySelector("#add")?.addEventListener("click", async () => {
    const f = await T.modal({ title: "Add employee", body: employeeForm(), submit: "Create" });
    if (!f) return;
    try { await T.api("/api/employees", { method: "POST", body: f }); T.toast("Employee added"); T.reload(); } catch (e) { T.toast(e.message, "err"); }
  });
  const genPw = () => { const c = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => c[b % c.length]).join(""); };
  const suggestEmail = (name) => {
    const dom = (ME.user.email.split("@")[1] || "company.com"), slug = name.toLowerCase().replace(/[^a-z0-9]+/g, ".").replace(/^\.|\.$/g, "");
    return `${slug}@${dom}`;
  };
  el.querySelectorAll("[data-reg]").forEach((b) => (b.onclick = async () => {
    const [id, decision] = b.dataset.reg.split(":"), p = pending.find((x) => x.id == id);
    let body = { decision };
    if (decision === "reject") {
      const f = await T.modal({ title: `Reject ${p.name}?`, submit: "Reject", danger: true, body: `<p class="muted small" style="margin-bottom:10px">An email will go to ${T.esc(p.email)} saying the registration wasn't approved.</p><div class="form-grid">${T.field("Reason (optional, included in the email)", "reason", "", "textarea", "full")}</div>` });
      if (!f) return; body.reason = f.reason;
    } else {
      const f = await T.modal({ title: `Approve ${p.name}`, submit: "Approve & email login details", body: `<p class="muted small" style="margin-bottom:12px">Choose the company login for this employee. It will be emailed to their personal address, <b>${T.esc(p.email)}</b>.</p>
        <div class="form-grid">${T.field("Company email id", "email", suggestEmail(p.name), "email", "full")}
        <div class="field full"><label>Password</label><div class="row" style="gap:6px"><input class="input" name="password" id="apw" value="${genPw()}" required minlength="6" autocomplete="off"><button type="button" class="btn" id="regen">Generate</button></div></div>
        ${T.field("Department (optional)", "department", "")}${T.field("Designation (optional)", "designation", "")}</div>`,
        onOpen: (ov) => (ov.querySelector("#regen").onclick = () => (ov.querySelector("#apw").value = genPw())) });
      if (!f) return; body = { decision, ...f };
    }
    b.disabled = true;
    try {
      const r = await T.api(`/api/registrations/${id}/decision`, { method: "POST", body });
      if (decision === "reject") T.toast("Registration rejected");
      else if (r.emailed) T.toast(`Login details emailed to ${r.personal_email}`);
      else await T.modal({ title: "Approved, but the email wasn't sent", submit: "", body: `<p style="margin-bottom:10px">${T.esc(p.name)}'s account is ready, but the email couldn't be sent${r.error ? ": <span class=\"muted\">" + T.esc(r.error) + "</span>" : ""}. Share these details with them yourself:</p>
        <div class="card" style="background:var(--surface-2);box-shadow:none"><div><b>Email id:</b> ${T.esc(body.email)}</div><div><b>Password:</b> <code>${T.esc(body.password)}</code></div></div>
        <p class="small muted" style="margin-top:10px">Set up email in Settings so this happens automatically next time.</p>` });
      T.reload();
    } catch (e) { T.toast(e.message, "err"); b.disabled = false; }
  }));
  const editEmployee = async (u) => {
    const f = await T.modal({ title: `Edit ${u.name}`, body: employeeForm(u) });
    if (!f) return;
    if (!f.password) delete f.password;
    if (f.active !== undefined) f.active = Number(f.active);
    try { await T.api(`/api/employees/${u.id}`, { method: "PUT", body: f }); T.toast("Saved"); T.reload(); } catch (e) { T.toast(e.message, "err"); }
  };
  const deleteEmployee = async (u) => {
    if (!(await T.confirm("Delete employee", `Remove ${u.name}? Their attendance history will be deleted and tasks unassigned.`))) return;
    try { await T.api(`/api/employees/${u.id}`, { method: "DELETE" }); T.toast("Employee removed"); T.reload(); } catch (e) { T.toast(e.message, "err"); }
  };
  const viewEmployee = async (u) => {
    await T.modal({ title: "Employee details", submit: "", wide: true, body: `
      <div class="row" style="gap:16px;align-items:center;margin-bottom:18px">${T.avatar(u, "lg")}
        <div style="min-width:0"><h2 style="margin-bottom:2px">${T.esc(u.name)}</h2><div class="muted">${T.esc(u.designation || "—")}${u.department ? " · " + T.esc(u.department) : ""}</div>
        <div class="row wrap" style="gap:6px;margin-top:8px">${T.badge(u.role)}${T.badge(u.active ? "Active" : "Inactive")}${T.statusBadge(u.status)}</div></div></div>
      <dl class="kv">
        <dt>Employee ID</dt><dd>TM-${String(u.id).padStart(4, "0")}</dd>
        <dt>Email</dt><dd>${T.esc(u.email)}</dd>
        <dt>Phone</dt><dd>${T.esc(u.phone || "—")}</dd>
        <dt>Gender</dt><dd>${T.esc(u.gender || "—")}</dd>
        <dt>Department</dt><dd>${T.esc(u.department || "—")}</dd>
        <dt>Designation</dt><dd>${T.esc(u.designation || "—")}</dd>
        <dt>Joined</dt><dd>${T.fmtDate(u.joined)}</dd>
        <dt>Address</dt><dd style="white-space:pre-wrap">${T.esc(u.address || "—")}</dd>
      </dl>
      ${can("employees.manage") ? `<div class="row mt" style="gap:10px"><button type="button" class="btn primary" id="vEdit">${T.icon("edit")}Edit</button><button type="button" class="btn danger" id="vDel">${T.icon("trash")}Delete</button></div>` : ""}`,
      onOpen: (ov) => {
        ov.querySelector("#vEdit")?.addEventListener("click", () => { ov.querySelector("[data-x]").click(); editEmployee(u); });
        ov.querySelector("#vDel")?.addEventListener("click", () => { ov.querySelector("[data-x]").click(); deleteEmployee(u); });
      } });
  };
  el.querySelector("#tb").onclick = async (ev) => {
    const eb = ev.target.closest("[data-e]"), db = ev.target.closest("[data-d]"), rb = ev.target.closest("[data-row]");
    if (eb) return editEmployee(all.find((x) => x.id == eb.dataset.e));
    if (db) return deleteEmployee(all.find((x) => x.id == db.dataset.d));
    if (rb) return viewEmployee(all.find((x) => x.id == rb.dataset.row));
  };
};

/* ---------------- Tasks ---------------- */
let PROJECTS = [];
const taskForm = (t = {}) => `<div class="form-grid">
  ${T.field("Title", "title", t.title, "text", "full")}
  ${T.field("Description", "description", t.description, "textarea", "full")}
  ${T.select("Assign to", "assigned_to", empOptions(), t.assigned_to ?? "")}
  ${T.field("Due date", "due_date", t.due_date || T.today(), "date")}
  <div class="field"><label>Project (optional)</label><input class="input" name="project" list="projlist" placeholder="Pick or type a project" value="${T.esc(t.project || "")}" maxlength="80"><datalist id="projlist">${PROJECTS.map((p) => `<option value="${T.esc(p)}">`).join("")}</datalist></div>
  ${T.select("Priority", "priority", ["High", "Medium", "Low"], t.priority || "Medium")}
  ${t.work_note ? `<div class="field full"><label>Work submitted by employee</label><div class="card" style="padding:10px 12px;white-space:pre-wrap">${T.esc(t.work_note)}</div></div>` : ""}</div>`;

V.tasks = async (el) => {
  await loadEmployees();
  const tasks = await T.api("/api/tasks");
  PROJECTS = [...new Set(tasks.map((t) => t.project).filter(Boolean))].sort();
  const TABS = ["All", "Assigned", "In Progress", "Submitted", "Approved"];
  let tab = "All", q = "", who = "";
  const mine = () => tasks.filter((t) => (!who || String(t.assigned_to) === who) && `${t.title} ${t.assignee}`.toLowerCase().includes(q));
  el.innerHTML = `<div><div class="toolbar"><div class="search">${T.icon("search")}<input class="input" id="q" placeholder="Search tasks"></div>
    <select class="input" id="who" style="width:200px">${empOptions().map(([v, l]) => `<option value="${v}">${v === "" ? "All employees" : T.esc(l)}</option>`).join("")}</select>
    <div class="tabs" id="tabs"></div>
    <div class="grow"></div><button class="btn primary" id="add">${T.icon("plus")}New task</button></div><div class="task-grid" id="tv"></div></div>`;
  const draw = () => {
    const base = mine();
    el.querySelector("#tabs").innerHTML = TABS.map((s) => `<button data-t="${s}" class="${s === tab ? "on" : ""}">${s} <span class="muted">${s === "All" ? base.length : base.filter((t) => t.status === s).length}</span></button>`).join("");
    el.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    const list = base.filter((t) => tab === "All" || t.status === tab);
    el.querySelector("#tv").innerHTML = list.map((t) => T.taskCard(t, { staff: true,
      actions: (t.status === "Submitted" ? `<button class="btn btn-sm success" data-review="${t.id}">Review work</button>` : "") + `<button class="btn btn-icon del" data-d="${t.id}" title="Delete task" aria-label="Delete task">${T.icon("trash")}</button>` })).join("")
      || `<div class="card empty">No ${tab === "All" ? "" : tab.toLowerCase() + " "}tasks</div>`;
  };
  draw();
  el.querySelector("#q").oninput = (e) => { q = e.target.value.toLowerCase(); draw(); };
  el.querySelector("#who").onchange = (e) => { who = e.target.value; draw(); };
  el.querySelector("#add").onclick = async () => {
    let ov;
    const f = await T.modal({ title: "New task", body: taskForm().replace(/<\/div>$/, T.attachFields() + "</div>"), submit: "Create task", onOpen: (o) => (ov = o) });
    if (!f) return;
    let id;
    try { ({ id } = await T.api("/api/tasks", { method: "POST", body: f })); } catch (e) { T.toast(e.message, "err"); return; }
    try { await T.sendAttach(id, ov); T.toast("Task created"); } catch (e) { T.toast("Task created, but the attachment failed: " + e.message, "err"); }
    T.reload();
  };
  el.querySelector("#tv").onclick = async (ev) => {
    const eb = ev.target.closest("[data-e]"), db = ev.target.closest("[data-d]"), rb = ev.target.closest("[data-review]");
    if (rb) {
      const t = tasks.find((z) => z.id == rb.dataset.review);
      const info = await T.api(`/api/tasks/${t.id}/info`);
      const decide = async (ov, decision) => {
        const comment = ov.querySelector("#cmt").value;
        try { await T.api(`/api/tasks/${t.id}/review`, { method: "POST", body: { decision, comment } }); ov.querySelector("[data-x]").click(); T.toast(decision === "approve" ? "Task approved" : "Changes requested — task reassigned"); T.reload(); } catch (e) { T.toast(e.message, "err"); }
      };
      await T.modal({ title: `Review: ${t.title}`, submit: "", wide: true, body: `<div class="small muted">Submitted by ${T.esc(t.assignee || "—")}</div>
        <div class="bold" style="margin-top:12px">Work description</div><div style="white-space:pre-wrap">${T.esc(info.task.work_note || "—")}</div>
        <div class="bold" style="margin-top:14px">Attachments</div><div class="row wrap" style="gap:6px;margin-top:6px">${T.attachments(info.attachments)}</div>
        ${info.feedback.length ? `<div class="bold" style="margin-top:14px">Previous feedback</div>${T.feedbackList(info.feedback)}` : ""}
        <div class="field" style="margin-top:16px"><label>Comment (required when requesting changes)</label><textarea class="input" id="cmt" rows="3" placeholder="What should the employee change?"></textarea></div>
        <div class="row" style="gap:8px;justify-content:flex-end"><button type="button" class="btn danger" id="chg">Request changes</button><button type="button" class="btn success" id="apr">Approve</button></div>`,
        onOpen: (ov) => { ov.querySelector("#chg").onclick = () => decide(ov, "changes"); ov.querySelector("#apr").onclick = () => decide(ov, "approve"); } });
      return;
    }
    if (db) {
      const t = tasks.find((x) => x.id == db.dataset.d);
      if (!(await T.confirm("Delete task", `Delete "${t.title}"? It will be removed for the employee too, including their notes, files and feedback.`))) return;
      await T.api(`/api/tasks/${t.id}`, { method: "DELETE" }); T.toast("Task deleted"); T.reload();
    }
  };
};

/* ---------------- Attendance ---------------- */
V.attendance = async (el, date = T.today(), q = "") => {
  const d = await T.api(`/api/attendance?date=${date}`);
  const count = (s) => d.records.filter((r) => r.status === s).length;
  el.innerHTML = `<div><div class="toolbar">
      <button class="btn btn-ghost" id="prev">‹</button><input type="date" class="input" id="dt" value="${d.date}" style="width:170px"><button class="btn btn-ghost" id="next">›</button>
      <button class="btn" id="tdy">Today</button><div class="search">${T.icon("search")}<input class="input" id="q" value="${T.esc(q)}" placeholder="Search name or department"></div>
      <div class="grow"></div><span class="muted bold">${new Date(d.date + "T00:00").toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span></div>
    <div class="grid g-4">${T.stat("Present", count("Present"), "check", "green")}${T.stat("Late", count("Late"), "clock", "amber")}
      ${T.stat("Absent", count("Absent"), "x", "pink")}${T.stat("On leave / Not marked", count("Leave") + count("Not marked"), "calendar", "cyan")}</div>
    <div class="card mt"><div class="card-h"><h3>Attendance register</h3><span class="hint" id="cnt">Click edit to mark or correct</span></div><div class="table-wrap"><table>
    <thead><tr><th>Employee</th><th>Department</th><th>Check-in</th><th>Check-out</th><th>Status</th><th>Note</th><th></th></tr></thead><tbody id="tb"></tbody></table></div></div></div>`;
  const draw = () => {
    const ql = q.toLowerCase();
    const list = d.records.filter((r) => `${r.name} ${r.department}`.toLowerCase().includes(ql));
    el.querySelector("#cnt").textContent = q ? `${list.length} of ${d.records.length} match "${q}"` : "Click edit to mark or correct";
    el.querySelector("#tb").innerHTML = list.map((r) => `<tr><td>${T.person(r)}</td><td class="muted">${T.esc(r.department)}</td><td>${T.fmtTime(r.check_in)}</td><td>${T.fmtTime(r.check_out)}</td>
      <td>${T.badge(r.status)}</td><td class="muted small">${T.esc(r.note || "")}</td><td><div class="actions"><button class="btn btn-sm" data-u="${r.id}">${T.icon("edit")}Mark</button></div></td></tr>`).join("")
      || `<tr><td colspan="7" class="empty">No matching employees</td></tr>`;
    el.querySelectorAll("[data-u]").forEach((b) => (b.onclick = () => markAttendance(b.dataset.u)));
  };
  const go = (nd) => V.attendance(el, nd, q);
  el.querySelector("#dt").onchange = (e) => go(e.target.value);
  el.querySelector("#prev").onclick = () => go(T.addDays(d.date, -1));
  el.querySelector("#next").onclick = () => go(T.addDays(d.date, 1));
  el.querySelector("#tdy").onclick = () => go(T.today());
  el.querySelector("#q").oninput = (e) => { q = e.target.value; draw(); };
  const markAttendance = async (uid) => {
    const r = d.records.find((x) => x.id == uid);
    const f = await T.modal({ title: `Mark attendance · ${r.name}`, body: `<div class="form-grid">
      ${T.select("Status", "status", ["Present", "Late", "Absent", "Leave"], r.status === "Not marked" ? "Present" : r.status, "full")}
      ${T.field("Check-in", "check_in", r.check_in || "09:30", "time")}${T.field("Check-out", "check_out", r.check_out || "", "time")}
      ${T.field("Note", "note", r.note, "text", "full")}</div>` });
    if (!f) return;
    try { await T.api("/api/attendance", { method: "POST", body: { ...f, user_id: r.id, date: d.date } }); T.toast("Attendance saved"); go(d.date); } catch (e) { T.toast(e.message, "err"); }
  };
  draw();
};

/* ---------------- Meetings ---------------- */
const meetingForm = (m = {}) => {
  const sel = new Set((m.participants || []).map((p) => p.id));
  return `<div class="form-grid">${T.field("Title", "title", m.title, "text", "full")}
  ${T.field("Date", "date", m.date || T.today(), "date")}<div class="field full"><label class="row" style="gap:8px;font-weight:600"><input type="checkbox" name="teamo_room" value="1" ${m.id ? (m.room_code ? "checked" : "") : "checked"}> Create a Teamo meeting room (video call inside Teamo)</label>
    <div class="small muted">A private link is created for you. People still need to be admitted before they can enter.</div></div>
  <div class="field full" id="extlink"><label>Or paste a meeting link from another platform</label><input class="input" name="location" value="${T.esc(m.room_code ? "" : m.location || "")}" placeholder="https://…"></div>
  ${T.field("Start", "start_time", m.start_time || "10:00", "time")}${T.field("End", "end_time", m.end_time || "11:00", "time")}
  ${T.field("Agenda", "description", m.description, "textarea", "full")}
  <div class="field full"><label>Participants <a class="small" style="color:var(--brand);cursor:pointer" data-all>select all</a></label><div class="check-list">
  ${EMPLOYEES.map((e) => `<label><input type="checkbox" name="participants[]" value="${e.id}" ${sel.has(e.id) ? "checked" : ""}>${T.esc(e.name)}</label>`).join("")}</div></div></div>`;
};
const meetingModal = (title, m) => T.modal({ title, body: meetingForm(m), wide: true,
  onOpen: (ov) => {
    ov.querySelector("[data-all]").onclick = () => ov.querySelectorAll(".check-list input").forEach((c) => (c.checked = true));
    const cb = ov.querySelector("[name=teamo_room]"), box = ov.querySelector("#extlink");
    const sync = () => (box.style.display = cb.checked ? "none" : "");
    cb.onchange = sync; sync();
  } });

V.meetings = async (el) => {
  await loadEmployees();
  const ms = await T.api("/api/meetings");
  let tab = "Scheduled";
  el.innerHTML = `<div><div class="toolbar"><div class="tabs" id="tabs">${["Scheduled", "In Progress", "Completed", "All"].map((t) => `<button data-t="${t}" class="${t === tab ? "on" : ""}">${t} <span class="muted">${t === "All" ? ms.length : ms.filter((m) => m.state === t).length}</span></button>`).join("")}</div>
    <div class="grow"></div><button class="btn primary" id="add">${T.icon("plus")}Schedule meeting</button></div><div class="grid g-3" id="mg"></div></div>`;
  const draw = () => {
    const list = ms.filter((m) => tab === "All" || m.state === tab);
    el.querySelector("#mg").innerHTML = list.map((m) => `<div class="card"><div class="row between" style="margin-bottom:12px">
        ${T.badge(m.state)}
        <div class="actions"><button class="btn btn-ghost" data-e="${m.id}">${T.icon("edit")}</button><button class="btn btn-ghost del" data-d="${m.id}">${T.icon("trash")}</button></div></div>
      <h3 style="font-size:16px">${T.esc(m.title)}</h3><p class="muted small" style="margin:4px 0 14px">${T.esc(m.description || "")}</p>
      <div class="small bold row" style="gap:6px">${T.icon("calendar")}${T.fmtDate(m.date)} · ${T.fmtTime(m.start_time)} – ${T.fmtTime(m.end_time)}</div>
      <div class="small muted row" style="gap:6px;margin-top:6px">${T.icon("pin")}${T.where(m.location, m.state === "Completed")}</div>
      ${m.room_code && m.state !== "Completed" ? `<a class="btn primary" style="margin-top:12px;text-decoration:none" target="_blank" rel="noopener" href="/meet/${m.room_code}?as=admin">${T.icon("video")}Start meeting</a>` : ""}
      ${(m.join_requests || []).length ? `<div style="margin-top:14px"><div class="small bold" style="margin-bottom:6px">Join requests</div>${m.join_requests.map((r) => `<div class="row between" style="gap:8px;padding:5px 0"><span class="small">${T.esc(r.name)}</span>
        ${r.status === "pending" ? `<span class="row" style="gap:6px"><button class="btn success" style="padding:4px 10px;font-size:12px" data-join="${m.id}:${r.user_id}:approve">Approve</button><button class="btn" style="padding:4px 10px;font-size:12px" data-join="${m.id}:${r.user_id}:deny">Deny</button></span>`
          : `<span class="badge ${r.status === "approved" ? "b-green" : "b-red"}">${r.status === "approved" ? "Approved" : "Denied"}</span>`}</div>`).join("")}</div>` : ""}
      <div class="row between" style="margin-top:16px"><div class="avatars">${m.participants.slice(0, 5).map((p) => T.avatar(p, "sm")).join("")}</div>
      <span class="small muted">${m.participants.length} participant${m.participants.length === 1 ? "" : "s"}</span></div></div>`).join("")
      || `<div class="card empty" style="grid-column:1/-1">No ${tab.toLowerCase()} meetings</div>`;
  };
  draw();
  el.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; el.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x === b)); draw(); }));
  el.querySelector("#add").onclick = async () => {
    const f = await meetingModal("Schedule meeting");
    if (!f) return;
    try { await T.api("/api/meetings", { method: "POST", body: f }); T.toast("Meeting scheduled"); T.reload(); } catch (e) { T.toast(e.message, "err"); }
  };
  el.querySelector("#mg").onclick = async (ev) => {
    const eb = ev.target.closest("[data-e]"), db = ev.target.closest("[data-d]"), jb = ev.target.closest("[data-join]");
    if (jb) {
      const [mid, uid, decision] = jb.dataset.join.split(":");
      try { await T.api(`/api/meetings/${mid}/join-requests/${uid}`, { method: "POST", body: { decision } }); T.toast(decision === "approve" ? "Request approved" : "Request denied"); T.reload(); } catch (e) { T.toast(e.message, "err"); }
      return;
    }
    if (eb) {
      const m = ms.find((x) => x.id == eb.dataset.e);
      const f = await meetingModal("Edit meeting", m);
      if (!f) return;
      f.participants ||= [];
      try { await T.api(`/api/meetings/${m.id}`, { method: "PUT", body: f }); T.toast("Meeting updated"); T.reload(); } catch (e) { T.toast(e.message, "err"); }
    }
    if (db) {
      const m = ms.find((x) => x.id == db.dataset.d);
      if (!(await T.confirm("Cancel meeting", `Delete "${m.title}"?`))) return;
      await T.api(`/api/meetings/${m.id}`, { method: "DELETE" }); T.toast("Meeting deleted"); T.reload();
    }
  };
};

/* ---------------- Reports ---------------- */
V.reports = async (el, from, to) => {
  to ||= T.today(); from ||= T.addDays(to, -29);
  const r = await T.api(`/api/reports?from=${from}&to=${to}`);
  const sum = (k) => r.employees.reduce((n, e) => n + e[k], 0);
  el.innerHTML = `<div><div class="toolbar"><div class="field" style="flex-direction:row;align-items:center;gap:8px"><label>From</label><input type="date" class="input" id="f" value="${from}" style="width:165px"></div>
    <div class="field" style="flex-direction:row;align-items:center;gap:8px"><label>To</label><input type="date" class="input" id="t" value="${to}" style="width:165px"></div>
    <div class="tabs" id="quick"><button data-n="6">7 days</button><button data-n="29" class="on">30 days</button><button data-n="89">90 days</button></div>
    <div class="grow"></div><a class="btn primary" href="/api/reports/export?from=${from}&to=${to}">${T.icon("download")}Export CSV</a></div>
    <div class="card mt"><div class="card-h"><h3>Team performance</h3><span class="hint">${T.fmtDate(r.range.from)} – ${T.fmtDate(r.range.to)}</span></div><div class="table-wrap"><table>
      <thead><tr><th>Employee</th><th>Hours</th><th>Avg/day</th><th>Attendance</th><th>Task completion</th><th>Meetings</th></tr></thead><tbody>
      ${r.employees.map((e) => `<tr><td>${T.person(e, e.department)}</td><td class="bold">${e.hours}</td><td>${e.avg_hours}h</td>
      <td style="min-width:130px"><div class="row" style="gap:8px"><div class="progress" style="flex:1"><i style="width:${e.attendance_rate}%"></i></div><span class="small bold">${e.attendance_rate}%</span></div></td>
      <td style="min-width:130px"><div class="row" style="gap:8px"><div class="progress" style="flex:1"><i style="width:${e.completion_rate}%;background:linear-gradient(90deg,#10b981,#34d399)"></i></div><span class="small bold">${e.completion_rate}%</span></div></td>
      <td>${e.meetings}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">No employees yet</td></tr>'}</tbody></table></div></div>
    <h3 style="margin:26px 0 14px">Attendance</h3>
    <div class="grid g-4">${T.stat("Avg attendance", r.totals.avg_attendance + "%", "check", "green")}${T.stat("Present days", sum("present"), "user", "indigo")}
      ${T.stat("Late arrivals", r.totals.late, "alert", "amber")}${T.stat("Absent days", sum("absent"), "x", "pink")}</div>
    <div class="card mt"><div class="card-h"><h3>Attendance history</h3><span class="hint">${r.records.length} records</span></div><div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Employee</th><th>Check-in</th><th>Check-out</th><th>Hours</th><th>Status</th></tr></thead><tbody>
      ${r.records.map((x) => `<tr><td class="bold">${T.fmtDate(x.date)}</td><td>${T.person(x, x.department)}</td><td>${T.fmtTime(x.check_in)}</td><td>${T.fmtTime(x.check_out)}</td><td>${x.hours ? x.hours + "h" : "—"}</td><td>${T.badge(x.status)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">No attendance records</td></tr>'}</tbody></table></div></div>
    <h3 style="margin:26px 0 14px">Task completion</h3>
    <div class="grid g-3">${T.stat("Tasks approved", r.totals.tasks_done, "zap", "cyan")}${T.stat("Total tasks", sum("tasks_total"), "list", "indigo")}
      ${T.stat("Completion rate", (sum("tasks_total") ? Math.round((100 * r.totals.tasks_done) / sum("tasks_total")) : 0) + "%", "check", "green")}</div>
    <div class="card mt"><div class="card-h"><h3>Completed tasks</h3><span class="hint">${r.completed_tasks.length} approved</span></div><div class="table-wrap"><table>
      <thead><tr><th>Task</th><th>Employee</th><th>Priority</th><th>Due</th><th>Approved on</th></tr></thead><tbody>
      ${r.completed_tasks.map((t) => `<tr><td class="bold">${T.esc(t.title)}</td><td>${T.esc(t.assignee || "—")}</td><td>${T.badge(t.priority)}</td><td>${T.fmtDate(t.due_date)}</td><td>${T.fmtDate(t.completed_at)}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">No completed tasks in this period</td></tr>'}</tbody></table></div></div></div>`;
  el.querySelector("#f").onchange = (e) => V.reports(el, e.target.value, to);
  el.querySelector("#t").onchange = (e) => V.reports(el, from, e.target.value);
  el.querySelectorAll("#quick button").forEach((b) => {
    b.classList.toggle("on", T.addDays(to, -Number(b.dataset.n)) === from);
    b.onclick = () => V.reports(el, T.addDays(T.today(), -Number(b.dataset.n)), T.today());
  });
};

/* ---------------- Settings ---------------- */
V.settings = async (el) => {
  const s = await T.api("/api/settings");
  const ro = can("settings.manage") ? "" : "disabled";
  el.innerHTML = `<div class="grid g-2"><form class="card" id="sf"><div class="card-h"><h3>Company & work hours</h3>${ro ? '<span class="badge b-gray">Read only</span>' : ""}</div>
    <div class="form-grid">${T.field("Company name", "company_name", s.company_name, "text", "full " + ro)}
    ${T.field("Work starts", "work_start", s.work_start, "time", ro)}${T.field("Work ends", "work_end", s.work_end, "time", ro)}
    ${T.field("Late grace (minutes)", "late_grace_minutes", s.late_grace_minutes, "number", ro)}
    ${T.select("Week starts on", "week_start", ["Monday", "Sunday"], s.week_start, ro)}
    ${T.field("Timezone", "timezone", s.timezone, "text", "full " + ro)}</div>
    ${ro ? "" : `<button class="btn primary mt">${T.icon("tick")}Save settings</button>`}</form>
    <form class="card" id="pf"><div class="card-h"><h3>Change your password</h3></div><div class="form-grid">
    ${T.field("Current password", "current", "", "password", "full")}${T.field("New password", "new", "", "password")}${T.field("Confirm", "confirm", "", "password")}</div>
    <button class="btn primary mt">${T.icon("lock")}Update password</button>
    <div class="card mt" style="background:var(--surface-2);box-shadow:none"><div class="bold">Signed in as</div><div class="mt" style="margin-top:10px">${T.person(ME.user, ME.user.email)}</div></div></form>
    ${ME.user.role === "admin" ? `<div class="card"><div class="card-h"><h3>Admins</h3></div>
      <p class="small muted" style="margin-bottom:14px">Give someone else full admin access to Teamo.</p>
      <button class="btn primary" id="newAdmin">${T.icon("plus")}Create new admin</button></div>` : ""}</div>`;
  el.querySelector("#sf").onsubmit = async (e) => {
    e.preventDefault();
    try { await T.api("/api/settings", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) }); T.toast("Settings saved"); } catch (er) { T.toast(er.message, "err"); }
  };
  el.querySelector("#pf").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.new !== f.confirm) return T.toast("Passwords don't match", "err");
    try { await T.api("/api/account/password", { method: "PUT", body: f }); T.toast("Password updated"); e.target.reset(); } catch (er) { T.toast(er.message, "err"); }
  };
  el.querySelector("#newAdmin")?.addEventListener("click", async () => {
    const body = `<div class="form-grid">${T.field("Full name", "name", "")}${T.field("Email", "email", "", "email")}
      ${T.field("Password", "password", "", "password")}${T.field("Phone", "phone", "")}</div>`;
    const f = await T.modal({ title: "Create new admin", body, submit: "Create admin" });
    if (!f) return;
    try { await T.api("/api/employees", { method: "POST", body: { ...f, role: "admin" } }); T.toast("Admin account created"); }
    catch (er) { T.toast(er.message, "err"); }
  });
};

/* ---------------- Email notifications (shown on the Permissions page) ---------------- */
const renderEmailSettings = async (el) => {
  const s = await T.api("/api/settings");
  const mailCard = `<form class="card" id="mf"><div class="card-h"><h3>Email notifications</h3>
      <label class="row" style="gap:8px;font-weight:600"><span class="switch"><input type="checkbox" name="mail_enabled" value="1" ${s.mail_enabled === "1" ? "checked" : ""}><span></span></span>Send emails</label></div>
    <p class="small muted" style="margin-bottom:14px">Emails go to employees when they register and when a manager approves or rejects their account. Use your email provider's SMTP details (for Gmail or Outlook, create an app password).</p>
    <div class="form-grid">${T.field("SMTP server", "mail_host", s.mail_host || "", "text", 'placeholder="smtp.gmail.com" autocomplete="off"')}${T.field("Port", "mail_port", s.mail_port || "", "number", 'placeholder="587" autocomplete="off"')}
    ${T.field("Username (full mailbox address)", "mail_user", s.mail_user || "", "text", 'placeholder="mailbox@yourcompany.com" autocomplete="off" autocapitalize="off" data-lpignore="true" data-1p-ignore="true" data-form-type="other" readonly onfocus="this.removeAttribute(\'readonly\')"')}
    <div class="field"><label>Mailbox password <span class="muted small">(not your Teamo password)</span></label><div class="row" style="gap:6px">
      <input class="input" name="mail_password" id="mpw" type="text" autocomplete="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-form-type="other" style="-webkit-text-security:disc;text-security:disc" placeholder="${s.mail_password_set ? "Saved. Leave blank to keep it" : "Password of the mail account"}" readonly onfocus="this.removeAttribute('readonly')">
      <button type="button" class="btn" id="mshow" title="Show or hide the password">${T.icon("search")}</button></div></div>
    ${T.field("From email", "mail_from", s.mail_from || "", "email", 'placeholder="hr@yourcompany.com" autocomplete="off"')}${T.field("From name", "mail_from_name", s.mail_from_name || "", "text", 'placeholder="e.g. Teamo HR" autocomplete="off"')}</div>
    <div class="row mt" style="gap:10px;flex-wrap:wrap"><button class="btn primary">${T.icon("tick")}Save email settings</button><button type="button" class="btn" id="mtest">${T.icon("activity")}Send test email</button></div>
</form>`;
  el.innerHTML = `<div style="max-width:980px">${mailCard}</div>`;
  const mf = el.querySelector("#mf");
  if (mf) {
    const mailBody = () => { const f = Object.fromEntries(new FormData(mf)); f.mail_enabled = f.mail_enabled ? "1" : "0"; return f; };
    mf.onsubmit = async (e) => { e.preventDefault(); try { await T.api("/api/settings", { method: "PUT", body: mailBody() }); T.toast("Email settings saved"); T.reload(); } catch (er) { T.toast(er.message, "err"); } };
    el.querySelector("#mshow").onclick = () => { const i = el.querySelector("#mpw"), hide = i.style.webkitTextSecurity !== "none"; i.style.webkitTextSecurity = i.style.textSecurity = hide ? "none" : "disc"; };
    el.querySelector("#mtest").onclick = async () => {
      const f = await T.modal({ title: "Send test email", submit: "Send", body: `<div class="form-grid">${T.field("Send the test to", "to", ME.user.email, "email", "full")}</div><p class="small muted" style="margin-top:10px">Your current email settings are saved first, then the message is sent.</p>` });
      if (!f) return;
      try { await T.api("/api/settings", { method: "PUT", body: mailBody() }); await T.api("/api/settings/test-email", { method: "POST", body: { to: f.to } }); T.toast("Test email sent. Check the inbox."); T.reload(); }
      catch (er) { T.toast(er.message, "err"); T.reload(); }
    };
  }
};

/* ---------------- Permissions ---------------- */
V.permissions = async (el) => {
  const { perms, employee_perms } = await T.api("/api/permissions");
  const editable = can("permissions.manage");
  const sw = (key, role, on, locked) => `<label class="switch" ${locked ? 'title="Always on, so admins can never lock themselves out"' : ""}><input type="checkbox" data-r="${role}" data-k="${key}" ${on ? "checked" : ""} ${editable && !locked ? "" : "disabled"}><span></span></label>`;
  const head = (t) => `<thead><tr><th>${t}</th><th>Key</th>`;
  el.innerHTML = `<div><div class="card" style="margin-bottom:20px"><div class="row">${T.icon("shield")}<div><b>Role-based access control</b>
    <div class="muted small">Switch permissions on or off for each role, then press Save changes. Changes apply the next time that person loads a page.</div></div></div></div>
    <div class="card"><div class="card-h"><h3>Admin &amp; manager permissions</h3>${editable ? `<button class="btn primary" id="save">${T.icon("tick")}Save changes</button>` : '<span class="badge b-gray">Read only</span>'}</div>
    <div class="table-wrap"><table>${head("Permission")}<th style="text-align:center">Admin</th><th style="text-align:center">Manager</th></tr></thead><tbody>
    ${perms.map((p) => `<tr><td class="bold">${T.esc(p.label)}</td><td><code class="small muted">${p.key}</code></td>
      <td style="text-align:center">${sw(p.key, "admin", p.admin, p.locked_admin)}</td><td style="text-align:center">${sw(p.key, "manager", p.manager)}</td></tr>`).join("")}</tbody></table></div></div>
    <div class="card mt"><div class="card-h"><h3>Employee permissions</h3></div>
    <div class="table-wrap"><table>${head("What employees can do")}<th style="text-align:center">Employee</th></tr></thead><tbody>
    ${employee_perms.map((p) => `<tr><td class="bold">${T.esc(p.label)}</td><td><code class="small muted">${p.key}</code></td><td style="text-align:center">${sw(p.key, "employee", p.employee)}</td></tr>`).join("")}</tbody></table></div></div></div>`;
  if (can("settings.manage")) {
    const box = document.createElement("div");
    box.className = "mt";
    el.firstElementChild.appendChild(box);
    await renderEmailSettings(box);
  }
  el.querySelector("#save")?.addEventListener("click", async () => {
    const body = { admin: {}, manager: {}, employee: {} };
    el.querySelectorAll("[data-k]:not(:disabled)").forEach((c) => (body[c.dataset.r][c.dataset.k] = c.checked));
    try { await T.api("/api/permissions", { method: "PUT", body }); T.toast("Permissions updated"); } catch (e) { T.toast(e.message, "err"); }
  });
};

T.boot("admin", async (me) => {
  ME = me;
  await loadEmployees().catch(() => {});
  T.shell({
    me, tagline: me.user.role === "admin" ? "Admin Console" : "Manager Console", views: V,
    nav: [
      { id: "dashboard", label: "Dashboard", icon: "grid", refresh: 30000 },
      { id: "employees", label: "Employee Management", icon: "users", perm: "employees.view", title: "Employee Management" },
      { id: "tasks", label: "Task Management", icon: "list", perm: "tasks.manage" },
      { id: "attendance", label: "Attendance", icon: "check", perm: "attendance.manage" },
      { id: "meetings", label: "Meeting Management", icon: "video", perm: "meetings.manage" },
      { id: "reports", label: "Reports & Analytics", icon: "chart", perm: "reports.view" },
      { id: "settings", label: "Settings", icon: "cog", sub: "System preferences and account" },
      { id: "permissions", label: "Permissions", icon: "shield", sub: "Role-based access control" },
    ],
  });
});

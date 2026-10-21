/* Teamo – Employee panel */
let ME;
const V = {};

const elapsed = (a) => {
  if (!a || !a.check_in) return { h: 0, label: "0h 0m" };
  const [h, m] = a.check_in.split(":").map(Number);
  let end = new Date();
  if (a.check_out) { const [h2, m2] = a.check_out.split(":").map(Number); end = new Date(); end.setHours(h2, m2, 0); }
  const start = new Date(); start.setHours(h, m, 0);
  const mins = Math.max(0, Math.round((end - start) / 60000));
  return { h: mins / 60, label: `${Math.floor(mins / 60)}h ${mins % 60}m` };
};

const punchCard = (a, workStart, workEnd) => {
  const e = elapsed(a);
  const [sh, sm] = workStart.split(":").map(Number), [eh, em] = workEnd.split(":").map(Number);
  const shift = ((eh * 60 + em) - (sh * 60 + sm)) / 60 || 9;
  const pct = Math.min(100, Math.round((e.h / shift) * 100));
  const state = !a || !a.check_in ? (a && ["Absent", "Leave"].includes(a.status) ? a.status : "Not checked in") : a.check_out ? "Checked out" : "Working";
  return `<div class="punch"><div class="ring" style="--p:${pct}"><div><b>${e.label}</b><small>of ${shift}h shift</small></div></div>
    <div style="flex:1;min-width:200px"><div class="row" style="margin-bottom:14px">${T.badge(state === "Working" ? "Present" : state)}${a && a.status === "Late" ? T.badge("Late") : ""}</div>
    <div class="punch-times"><div><small>Check-in</small><b>${T.fmtTime(a?.check_in)}</b></div><div><small>Check-out</small><b>${T.fmtTime(a?.check_out)}</b></div>
    <div><small>Shift</small><b>${T.fmtTime(workStart)} – ${T.fmtTime(workEnd)}</b></div></div>
    <div class="row mt">${!a || !a.check_in
      ? (a && ["Absent", "Leave"].includes(a.status) ? '<span class="muted">Marked by admin for today</span>' : `<button class="btn success lg" data-act="checkin">${T.icon("login")}Check in</button>`)
      : !a.check_out ? `<button class="btn danger lg" data-act="checkout">${T.icon("logout")}Check out</button>` : '<span class="muted bold">✅ Day complete — great work!</span>'}</div></div></div>`;
};

const bindPunch = (el) => el.querySelectorAll("[data-act]").forEach((b) => (b.onclick = async () => {
  b.disabled = true;
  try {
    const r = await T.api(`/api/me/${b.dataset.act}`, { method: "POST" });
    T.toast(b.dataset.act === "checkin" ? `Checked in at ${T.fmtTime(r.time)}${r.status === "Late" ? " (late)" : ""}` : b.dataset.act === "break/start" ? `Break started at ${T.fmtTime(r.time)}` : b.dataset.act === "break/end" ? `Break ended at ${T.fmtTime(r.time)}` : `Checked out at ${T.fmtTime(r.time)}`);
    T.reload();
  } catch (e) { T.toast(e.message, "err"); b.disabled = false; }
}));

const TASKS = {};
const taskRow = (t) => {
  TASKS[t.id] = t;
  const btn = (act, cls, label) => `<button class="btn btn-sm ${cls}" data-task="${t.id}" data-act="${act}">${label}</button>`;
  return T.taskCard(t, { actions: btn("view", "", "View") + (t.status === "Assigned" ? btn("start", "primary", "Start") : "")
    + (t.status === "In Progress" ? btn("update", "", "Update") + btn("submit", "success", "Submit work") : "") });
};

const bindTasks = (el) => {
  const save = async (id, body, msg) => {
    try { await T.api(`/api/me/tasks/${id}`, { method: "PUT", body }); T.toast(msg); T.reload(); } catch (e) { T.toast(e.message, "err"); }
  };
  const noteForm = (t, label) => `<div class="form-grid">${T.field(label, "note", t.work_note || "", "textarea", "full")}</div>`;
  el.querySelectorAll(".task-card").forEach((c) => {
    c.style.cursor = "pointer";
    c.onclick = (ev) => { if (!ev.target.closest("button, a, input, select, textarea")) c.querySelector('[data-act="view"]')?.click(); };
  });
  el.querySelectorAll("[data-task]").forEach((b) => (b.onclick = async () => {
    const t = TASKS[b.dataset.task], act = b.dataset.act;
    if (act === "view") {
      const info = await T.api(`/api/tasks/${t.id}/info`);
      await T.modal({ title: t.title, submit: "", body: `<p>${T.esc(t.description || "No description")}</p>
        <div class="row wrap" style="gap:6px;margin:12px 0">${T.badge(t.priority)}${T.badge(t.status)}<span class="small muted">Due ${T.fmtDate(t.due_date)}</span></div>
        <div class="small muted">Assigned by ${T.esc(t.creator || "—")}</div>
        ${t.work_note ? `<div class="bold" style="margin-top:14px">Work notes</div><div style="white-space:pre-wrap">${T.esc(t.work_note)}</div>` : ""}
        <div class="bold" style="margin-top:14px">Attachments</div><div class="row wrap" style="gap:6px;margin-top:6px">${T.attachments(info.attachments, { removable: (a) => ["Assigned", "In Progress"].includes(t.status) && a.uploaded_by === ME.user.name })}</div>
        ${info.feedback.length ? `<div class="bold" style="margin-top:14px">Manager feedback</div>${T.feedbackList(info.feedback)}` : ""}` });
    } else if (act === "start") {
      save(t.id, { status: "In Progress" }, "Task started");
    } else if (act === "update") {
      let ov;
      const f = await T.modal({ title: "Update progress", submit: "Save update", onOpen: (o) => (ov = o), body: `<div class="form-grid">${T.field("What have you done so far?", "note", t.work_note || "", "textarea", "full")}${T.attachFields()}</div>` });
      if (!f) return;
      try { await T.sendAttach(t.id, ov); } catch (er) { T.toast(er.message, "err"); return; }
      save(t.id, { note: f.note }, "Progress saved");
    } else if (act === "submit") {
      let ov;
      const f = await T.modal({ title: "Submit work", submit: "Submit for review", onOpen: (o) => (ov = o),
        body: `<div class="form-grid">${T.field("Describe the work you completed", "note", t.work_note || "", "textarea", "full")}${T.attachFields()}</div>` });
      if (!f) return;
      try { await T.sendAttach(t.id, ov); } catch (er) { T.toast(er.message, "err"); return; }
      save(t.id, { status: "Submitted", note: f.note }, "Work submitted for review");
    }
  }));
};

const joinInfo = (m) => {
  if (!m.has_link) return T.esc(m.location || "—");
  if (m.state === "Completed") return '<span class="muted">Meeting ended · link expired</span>';
  if (m.join_status === "approved") return T.where(m.location);
  if (m.join_status === "pending") return '<span class="badge b-amber">Waiting for manager approval</span>';
  return `${m.join_status === "denied" ? '<span class="badge b-red">Request denied</span> ' : ""}<button class="btn primary" style="padding:4px 12px;font-size:12px" data-req="${m.id}">${m.join_status === "denied" ? "Request again" : "Request to join"}</button>`;
};
document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-req]");
  if (!b) return;
  b.disabled = true;
  try { await T.api(`/api/me/meetings/${b.dataset.req}/join-request`, { method: "POST" }); T.toast("Request sent to your manager"); T.reload(); } catch (e) { T.toast(e.message, "err"); b.disabled = false; }
});

const meetingRow = (m) => `<div class="li"><div class="time-chip">${T.fmtTime(m.start_time).replace(" ", "<small>")}</small></div>
  <div class="grow"><div class="t">${T.esc(m.title)}</div><div class="s">${T.fmtTime(m.start_time)} – ${T.fmtTime(m.end_time)} · ${joinInfo(m)}</div></div>
  ${T.badge(m.state)}</div>`;

/* ---------------- Dashboard ---------------- */
V.dashboard = async (el) => {
  const [d, team] = await Promise.all([T.api("/api/me/dashboard"), T.api("/api/me/team").catch(() => [])]);
  const hour = new Date().getHours();
  const greet = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const open = d.tasks.filter((t) => t.status !== "Approved").length;
  const done = d.tasks.filter((t) => t.status === "Approved").length;
  const next = d.meetings.find((m) => m.state !== "Completed");
  el.innerHTML = `<div>
    <div class="card hero"><div class="row between wrap"><div><h2>${greet}, ${T.esc(d.user.name.split(" ")[0])} ✨</h2>
      <p>${T.esc(d.user.designation)} · ${T.esc(d.user.department)} — you have ${open} open task${open === 1 ? "" : "s"} and ${d.meetings.length} meeting${d.meetings.length === 1 ? "" : "s"} today.</p></div>
      ${next ? `<div style="background:rgba(255,255,255,.14);padding:12px 16px;border-radius:14px;position:relative"><div class="small" style="opacity:.8">${next.state === "In Progress" ? "Happening now" : "Up next"}</div><b>${T.esc(next.title)}</b><div class="small">${T.fmtTime(next.start_time)} · ${T.esc(next.location)}</div></div>` : ""}</div></div>

    <div class="grid g-3 mt">
      ${T.stat("Today's attendance", d.attendance?.check_in ? T.fmtTime(d.attendance.check_in) : (d.attendance?.status || "—"), "check", "green", d.attendance ? T.badge(d.attendance.check_out ? "Checked out" : d.attendance.status) : "Not checked in yet")}
      ${T.stat("Today's tasks", `${done}/${d.tasks.length}`, "list", "indigo", `${open} remaining`)}
      ${T.stat("Meetings today", d.meetings.length, "video", "pink", next ? `Next: ${T.fmtTime(next.start_time)}` : "No more today")}
    </div>

    <div class="grid mt">
      <div class="card"><div class="card-h"><h3>Today's attendance</h3><span class="hint">${new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</span></div>${punchCard(d.attendance, d.work_start, d.work_end)}</div>
    </div>

    <div class="grid g-2 mt">
      <div class="card"><div class="card-h"><h3>Today's tasks</h3><a class="hint" href="#tasks">All tasks</a></div><div class="task-grid">${d.tasks.map(taskRow).join("") || '<div class="empty">No tasks due today 🎉</div>'}</div></div>
      <div class="grid" style="align-content:start">
        <div class="card"><div class="card-h"><h3>Today's meetings</h3><a class="hint" href="#meetings">All meetings</a></div><div class="list">${d.meetings.map(meetingRow).join("") || '<div class="muted">No meetings today</div>'}</div></div>
        <div class="card"><div class="card-h"><h3>My team</h3><span class="hint row" style="gap:6px"><span class="live-dot"></span>Live</span></div><div class="list">
          ${team.map((t) => `<div class="li"><div class="grow">${T.person(t, t.designation)}</div>${T.statusBadge(t.live_status)}</div>`).join("") || `<div class="muted">${d.user.department ? "No one else in your department yet" : "You're not assigned to a department yet"}</div>`}</div></div>
        <div class="card"><div class="card-h"><h3>My task progress</h3></div>${T.donut([{ label: "Assigned", value: d.task_counts.Assigned, color: "#f59e0b" }, { label: "In Progress", value: d.task_counts["In Progress"], color: "#3b82f6" }, { label: "Submitted", value: d.task_counts.Submitted, color: "#8b5cf6" }, { label: "Approved", value: d.task_counts.Approved, color: "#10b981" }], "Tasks")}</div>
      </div>
    </div></div>`;
  bindPunch(el); bindTasks(el);
};

/* ---------------- Attendance ---------------- */
V.attendance = async (el) => {
  const { today: a } = await T.api("/api/me/attendance");
  const checkedIn = !!a?.check_in, out = !!a?.check_out;
  const worked = Math.max(0, elapsed(a).h - (a?.break_minutes || 0) / 60);
  const hrs = `${Math.floor(worked)}h ${Math.round((worked % 1) * 60)}m`;
  const brk = a?.break_minutes ? `${a.break_minutes} min${a.on_break ? " (on break)" : ""}` : (a?.on_break ? "On break" : "—");
  const btn = (act, cls, icon, label) => `<button class="btn ${cls} lg" data-act="${act}">${T.icon(icon)}${label}</button>`;
  el.innerHTML = `<div class="card"><div class="card-h"><h3>Attendance</h3></div>
    <div class="punch-times"><div><small>Check-in</small><b>${T.fmtTime(a?.check_in)}</b></div><div><small>Break</small><b>${brk}</b></div>
    <div><small>Check-out</small><b>${T.fmtTime(a?.check_out)}</b></div><div><small>Hours</small><b>${checkedIn ? hrs : "—"}</b></div></div>
    <div class="row mt">${!checkedIn ? btn("checkin", "success", "login", "Check in")
      : out ? '<span class="muted bold">✅ Day complete — great work!</span>'
      : (a.on_break ? btn("break/end", "primary", "tick", "End break") : btn("break/start", "ghost", "clock", "Start break")) + btn("checkout", "danger", "logout", "Check out")}</div></div>`;
  bindPunch(el);
};

/* ---------------- My tasks ---------------- */
V.tasks = async (el) => {
  const tasks = await T.api("/api/me/tasks");
  let tab = "Open";
  el.innerHTML = `<div><div class="toolbar"><div class="tabs" id="tabs">${["Open", "Assigned", "In Progress", "Submitted", "Approved", "All"].map((t) => `<button data-t="${t}" class="${t === tab ? "on" : ""}">${t}</button>`).join("")}</div></div>
    <div class="grid g-4" id="stats" style="margin-bottom:20px">${[["Assigned", "Assigned", "clock", "amber"], ["In Progress", "In progress", "zap", "indigo"], ["Submitted", "Submitted", "list", "pink"], ["Approved", "Approved", "check", "green"]]
      .map(([s, label, ic, col]) => T.stat(label, tasks.filter((t) => t.status === s).length, ic, col).replace('<div class="card stat', `<div data-tab="${s}" title="Show ${label.toLowerCase()} tasks" style="cursor:pointer" class="card stat`)).join("")}</div>
    <div class="task-grid" id="tl"></div></div>`;
  const draw = () => {
    el.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("on", x.dataset.t === tab));
    el.querySelectorAll("#stats [data-tab]").forEach((x) => (x.style.outline = x.dataset.tab === tab ? "2px solid var(--brand)" : "none"));
    const list = tasks.filter((t) => tab === "All" || (tab === "Open" ? t.status !== "Approved" : t.status === tab));
    el.querySelector("#tl").innerHTML = list.map(taskRow).join("") || '<div class="empty">No tasks here</div>';
    bindTasks(el);
  };
  draw();
  el.querySelectorAll("#tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
  // clicking a status card toggles that filter; clicking it again shows the open tasks
  el.querySelectorAll("#stats [data-tab]").forEach((c) => (c.onclick = () => { tab = tab === c.dataset.tab ? "Open" : c.dataset.tab; draw(); }));
};

/* ---------------- Meetings ---------------- */
V.meetings = async (el) => {
  const ms = await T.api("/api/me/meetings");
  const up = ms.filter((m) => m.state !== "Completed").reverse(), past = ms.filter((m) => m.state === "Completed");
  const card = (m) => `<div class="card"><div class="row between" style="margin-bottom:10px">${T.badge(m.state)}<span class="small muted">by ${T.esc(m.organiser || "—")}</span></div>
    <h3 style="font-size:16px">${T.esc(m.title)}</h3><p class="small muted" style="margin:4px 0 12px">${T.esc(m.description || "")}</p>
    <div class="small bold row" style="gap:6px">${T.icon("calendar")}${T.fmtDate(m.date)} · ${T.fmtTime(m.start_time)} – ${T.fmtTime(m.end_time)}</div>
    <div class="small muted row" style="gap:6px;margin-top:6px">${T.icon("pin")}${joinInfo(m)}</div>
    <div class="avatars" style="margin-top:14px">${m.participants.slice(0, 6).map((p) => T.avatar(p, "sm")).join("")}</div></div>`;
  el.innerHTML = `<div><h3 style="margin-bottom:14px">Scheduled</h3><div class="grid g-3">${up.map(card).join("") || '<div class="card empty" style="grid-column:1/-1">No scheduled meetings</div>'}</div>
    <h3 style="margin:28px 0 14px">Past meetings</h3><div class="grid g-3">${past.map(card).join("") || '<div class="card empty" style="grid-column:1/-1">No past meetings</div>'}</div></div>`;
};

/* ---------------- My reports ---------------- */
V.reports = async (el, n = 29) => {
  const to = T.today(), from = T.addDays(to, -n);
  const r = await T.api(`/api/me/reports?from=${from}&to=${to}`);
  const s = r.summary;
  el.innerHTML = `<div><div class="toolbar"><div class="tabs" id="quick">${[[6, "7 days"], [29, "30 days"], [89, "90 days"]].map(([v, l]) => `<button data-n="${v}" class="${v === n ? "on" : ""}">${l}</button>`).join("")}</div>
    <div class="grow"></div><span class="muted small">${T.fmtDate(r.range.from)} – ${T.fmtDate(r.range.to)}</span></div>
    <h3 style="margin-bottom:14px">Summary</h3>
    <div class="grid g-4">${T.stat("Hours worked", s.hours, "clock", "indigo", `${s.avg_hours}h average per day`)}${T.stat("Attendance rate", s.attendance_rate + "%", "check", "green", `${s.present} days present, ${s.late} late`)}
    ${T.stat("Tasks approved", `${s.tasks_done}/${s.tasks_total}`, "zap", "cyan", `${s.completion_rate}% completion`)}${T.stat("Meetings", s.meetings, "video", "pink", `${s.absent} absent · ${s.leave} on leave`)}</div>
    <div class="card mt"><div class="card-h"><h3>Attendance history</h3><span class="hint">${r.records.length} records</span></div><div class="table-wrap"><table>
    <thead><tr><th>Date</th><th>Day</th><th>Check-in</th><th>Check-out</th><th>Hours</th><th>Status</th></tr></thead><tbody>
    ${r.records.map((x) => `<tr><td class="bold">${T.fmtDate(x.date)}</td><td class="muted">${new Date(x.date + "T00:00").toLocaleDateString("en-IN", { weekday: "short" })}</td>
    <td>${T.fmtTime(x.check_in)}</td><td>${T.fmtTime(x.check_out)}</td><td>${x.hours ? x.hours + "h" : "—"}</td><td>${T.badge(x.status)}</td></tr>`).join("") || '<tr><td colspan="6" class="empty">No attendance records</td></tr>'}</tbody></table></div></div>
    <div class="card mt"><div class="card-h"><h3>Completed tasks</h3><span class="hint">${r.completed_tasks.length} approved</span></div><div class="table-wrap"><table>
    <thead><tr><th>Task</th><th>Priority</th><th>Due</th><th>Approved on</th></tr></thead><tbody>
    ${r.completed_tasks.map((t) => `<tr><td class="bold">${T.esc(t.title)}</td><td>${T.badge(t.priority)}</td><td>${T.fmtDate(t.due_date)}</td><td>${T.fmtDate(t.completed_at)}</td></tr>`).join("") || '<tr><td colspan="4" class="empty">No completed tasks in this period</td></tr>'}</tbody></table></div></div></div>`;
  el.querySelectorAll("#quick button").forEach((b) => (b.onclick = () => V.reports(el, Number(b.dataset.n))));
};

/* ---------------- Profile ---------------- */
V.profile = async (el) => {
  const me = (await T.api("/api/me")).user;
  el.innerHTML = `<div><div class="card hero"><div class="profile-head row"><div class="avatar lg" style="background:rgba(255,255,255,.2)">${T.esc(T.initials(me.name))}</div>
    <div><h2>${T.esc(me.name)}</h2><p>${T.esc(me.designation)} · ${T.esc(me.department)}</p></div></div></div>
    <div class="grid g-2 mt"><div class="card"><div class="card-h"><h3>Personal details</h3></div><dl class="kv">
      <dt>Email</dt><dd>${T.esc(me.email)}</dd><dt>Phone</dt><dd>${T.esc(me.phone || "—")}</dd><dt>Gender</dt><dd>${T.esc(me.gender || "—")}</dd><dt>Address</dt><dd style="white-space:pre-wrap">${T.esc(me.address || "—")}</dd><dt>Department</dt><dd>${T.esc(me.department)}</dd>
      <dt>Designation</dt><dd>${T.esc(me.designation)}</dd><dt>Joined</dt><dd>${T.fmtDate(me.joined)}</dd><dt>Employee ID</dt><dd>TM-${String(me.id).padStart(4, "0")}</dd></dl>
      <form id="pf" class="mt"><div class="form-grid">${T.field("Display name", "name", me.name)}${T.field("Phone", "phone", me.phone)}</div><button class="btn primary mt">${T.icon("tick")}Save profile</button></form></div>
    <form class="card" id="pw"><div class="card-h"><h3>Change password</h3></div><div class="form-grid">${T.field("Current password", "current", "", "password", "full")}
      ${T.field("New password", "new", "", "password")}${T.field("Confirm password", "confirm", "", "password")}</div><button class="btn primary mt">${T.icon("lock")}Update password</button></form></div></div>`;
  el.querySelector("#pf").onsubmit = async (e) => {
    e.preventDefault();
    try { await T.api("/api/me/profile", { method: "PUT", body: Object.fromEntries(new FormData(e.target)) }); T.toast("Profile updated"); setTimeout(() => location.reload(), 600); } catch (er) { T.toast(er.message, "err"); }
  };
  el.querySelector("#pw").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.new !== f.confirm) return T.toast("Passwords don't match", "err");
    try { await T.api("/api/account/password", { method: "PUT", body: f }); T.toast("Password updated"); e.target.reset(); } catch (er) { T.toast(er.message, "err"); }
  };
};

T.boot("employee", (me) => {
  ME = me;
  T.shell({
    me, tagline: "Employee Workspace", views: V,
    nav: [
      { id: "dashboard", label: "Dashboard", icon: "grid", refresh: 60000 },
      { id: "attendance", label: "Attendance", icon: "check" },
      { id: "tasks", label: "My Tasks", icon: "list" },
      { id: "meetings", label: "Meetings", icon: "video" },
      { id: "reports", label: "My Reports", icon: "chart" },
      { id: "profile", label: "My Profile", icon: "user", sub: "Personal details & security" },
    ],
  });
});

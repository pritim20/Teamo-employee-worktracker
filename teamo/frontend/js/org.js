/* Teamo – employee directory, organization chart and team management (shared by both panels) */

const roleLabel = (p) => (p.role === "admin" ? "Admin" : p.role === "manager" ? "Manager" : p.is_lead ? "Team Lead" : "Employee");
const roleBadge = (p) => `<span class="badge b-${p.role === "admin" ? "violet" : p.role === "manager" ? "blue" : p.is_lead ? "amber" : "gray"}">${roleLabel(p)}</span>`;
const canManageTeams = () => !!T.me?.perms.includes("teams.manage");
// chips that open a person's profile; every list below uses these so any name is clickable
const chip = (p, sub) => `<button type="button" class="pchip" data-person="${p.id}">${T.avatar(p, "sm")}<span><b>${T.esc(p.name)}</b><small>${T.esc(sub ?? p.designation ?? "")}</small></span></button>`;
const projectChips = (list, max = 99) => list.slice(0, max).map((x) => `<span class="pill" title="${x.open} open · ${x.done} done">${T.esc(x.name)}</span>`).join("") + (list.length > max ? `<span class="pill muted">+${list.length - max}</span>` : "");

/* ---- profile photo: resized in the browser to a small JPEG, so it travels as a few KB of text ---- */
T.pickPhoto = (userId) => new Promise((resolve) => {
  const input = document.createElement("input");
  input.type = "file"; input.accept = "image/*";
  input.onchange = async () => {
    const f = input.files[0];
    if (!f) return resolve(false);
    try {
      const img = await new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => no(new Error("That file isn't an image")); i.src = URL.createObjectURL(f); });
      const c = document.createElement("canvas"), n = 128, s = Math.min(img.width, img.height);
      c.width = c.height = n;
      c.getContext("2d").drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, n, n);
      await T.api(`/api/org/photo/${userId}`, { method: "PUT", body: { photo: c.toDataURL("image/jpeg", 0.8) } });
      T.toast("Photo updated");
      resolve(true);
    } catch (e) { T.toast(e.message, "err"); resolve(false); }
  };
  input.click();
});
T.removePhoto = async (userId) => { try { await T.api(`/api/org/photo/${userId}`, { method: "PUT", body: { photo: "" } }); T.toast("Photo removed"); return true; } catch (e) { T.toast(e.message, "err"); return false; } };
T.photoControl = (u) => `<div class="row" style="gap:8px;margin-top:10px"><button type="button" class="btn btn-sm" data-photo="set">${T.icon("upload")}${u.photo ? "Change photo" : "Add photo"}</button>${u.photo ? `<button type="button" class="btn btn-sm del" data-photo="clear">Remove</button>` : ""}</div>`;
T.bindPhoto = (root, userId) => root.querySelectorAll("[data-photo]").forEach((b) => (b.onclick = async () => {
  if (await (b.dataset.photo === "set" ? T.pickPhoto(userId) : T.removePhoto(userId))) setTimeout(() => location.reload(), 500);
}));

/* ---- person profile popup (opened from the directory, the chart and the team lists) ---- */
T.peopleCache = new Map(); // brief info the lists already loaded, so a profile can open instantly
let openPerson = null; // id being shown, so a live update can refresh the open popup
T.personModal = async (startId) => {
  const stack = [];
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="modal" style="max-width:720px"><div class="modal-h"><h3>Profile</h3><button type="button" class="icon-btn" data-x>${T.icon("x")}</button></div><div class="modal-b" id="pbody"></div></div>`;
  const body = ov.querySelector("#pbody");
  const close = () => { ov.remove(); openPerson = null; T.onLive = null; };
  ov.addEventListener("click", (e) => {
    if (e.target === ov || e.target.closest("[data-x]")) return close();
    const p = e.target.closest("[data-person]");
    if (p) { stack.push(openPerson); load(Number(p.dataset.person)); }
    if (e.target.closest("[data-back]")) load(stack.pop());
    const ph = e.target.closest("[data-photo]");
    if (ph) (async () => { if (await (ph.dataset.photo === "set" ? T.pickPhoto(openPerson) : T.removePhoto(openPerson))) load(openPerson, true); })();
  });
  const row = (k, v) => `<div class="prow"><span>${k}</span><div>${v}</div></div>`;
  async function load(id, quiet) {
    let p;
    const hint = !quiet && T.peopleCache.get(id);
    if (hint) { // show who it is straight away; the details fill in a moment later
      body.innerHTML = `${stack.length ? `<button type="button" class="btn btn-sm" data-back style="margin-bottom:12px">← Back</button>` : ""}<div class="phead">${T.avatar(hint, "lg")}<div style="min-width:0"><h2>${T.esc(hint.name)}</h2><div class="muted">${T.esc(hint.designation || "—")}${hint.department ? " · " + T.esc(hint.department) : ""}</div><div class="row" style="gap:6px;margin-top:8px">${roleBadge(hint)}</div></div></div><div class="psec"><div class="muted">Loading details…</div></div>`;
      openPerson = id;
    }
    try { p = await T.api(`/api/org/people/${id}`); } catch (e) { if (!quiet) T.toast(e.message, "err"); close(); return; }
    openPerson = id;
    const w = p.work, scroll = body.scrollTop;
    body.innerHTML = `${stack.length ? `<button type="button" class="btn btn-sm" data-back style="margin-bottom:12px">← Back</button>` : ""}
      <div class="phead">${T.avatar(p, "lg")}<div style="min-width:0"><h2>${T.esc(p.name)}</h2><div class="muted">${T.esc(p.designation || "—")}${p.department ? " · " + T.esc(p.department) : ""}</div>
        <div class="row" style="gap:6px;margin-top:8px;flex-wrap:wrap">${roleBadge(p)}${T.statusBadge(p.live_status)}</div>
        ${T.me && (T.me.user.id === p.id || T.me.perms.includes("employees.manage")) ? T.photoControl(p) : ""}</div></div>
      <div class="psec"><h4>Work status</h4>
        <div class="pstats"><div><b>${w.today === "Not marked" ? "—" : T.fmtTime(w.login_time)}</b><small>Login today</small></div><div><b>${w.logout_time ? T.fmtTime(w.logout_time) : "—"}</b><small>Logout</small></div>
        <div><b>${w.tasks.Assigned}</b><small>Assigned</small></div><div><b>${w.tasks["In Progress"]}</b><small>In progress</small></div><div><b>${w.tasks.Submitted}</b><small>Submitted</small></div><div><b>${w.tasks.Approved}</b><small>Approved</small></div></div></div>
      <div class="psec"><h4>Reporting</h4>
        ${row("Reports to", p.reports_to ? chip(p.reports_to) : '<span class="muted">Nobody (top of the chart)</span>')}
        ${p.led_teams.length ? row("Leads", p.led_teams.map((t) => `<span class="pill">${T.esc(t.name)} · ${t.size} members</span>`).join("")) : ""}
        ${row(p.reports.length ? `Direct reports (${p.reports.length})` : "Direct reports", p.reports.length ? `<div class="pchips">${p.reports.map((r) => chip(r, `${r.designation || ""}${r.projects.length ? " · " + r.projects.slice(0, 2).join(", ") : ""}`)).join("")}</div>` : '<span class="muted">None</span>')}</div>
      <div class="psec"><h4>Teams</h4>${p.teams.length ? p.teams.map((t) => row(T.esc(t.name), `<span class="muted small">${T.esc(t.department || "No department")} · ${t.size} members</span> ${t.lead && !t.you_lead ? `<div style="margin-top:6px"><small class="muted">Team lead</small>${chip(t.lead)}</div>` : '<span class="badge b-amber">Team Lead</span>'}`)).join("") : '<span class="muted">Not in a team yet</span>'}</div>
      <div class="psec"><h4>Projects</h4>${p.projects.length ? `<div class="pills">${projectChips(p.projects)}</div>` : '<span class="muted">No projects assigned</span>'}</div>
      <div class="psec"><h4>Contact</h4>${p.contact ? `<dl class="kv"><dt>Company email</dt><dd>${T.esc(p.contact.email)}</dd><dt>Phone</dt><dd>${T.esc(p.contact.phone || "—")}</dd>${p.contact.personal_email ? `<dt>Personal email</dt><dd>${T.esc(p.contact.personal_email)}</dd>` : ""}<dt>Address</dt><dd style="white-space:pre-wrap">${T.esc(p.contact.address || "—")}</dd></dl>`
        : `<div class="muted small">${T.icon("lock")} Contact details are private. They're only visible to the person themselves and to admins and managers.</div>`}</div>`;
    body.scrollTop = scroll;
    T.onLive = () => load(openPerson, true);
  }
  document.body.appendChild(ov);
  await load(startId);
  if (!openPerson) ov.remove();
};
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-person]");
  if (p && !p.closest(".overlay")) T.personModal(Number(p.dataset.person));
});

/* ---- one Organization page: Directory | Organization chart | Teams ---- */
let orgTab = "directory";
T.orgView = async (el) => {
  const TABS = [["directory", "Directory", T.directoryView], ["chart", "Organization chart", T.orgChartView], ["teams", canManageTeams() ? "Team management" : "Teams", T.teamsView]];
  // the page body is never emptied while the next data loads, so a live update doesn't flash blank
  if (!el.querySelector("#otabs")) el.innerHTML = `<div class="toolbar" style="margin-bottom:16px"><div class="tabs" id="otabs"></div></div><div id="obody"></div>`;
  el.querySelector("#otabs").innerHTML = TABS.map(([k, l]) => `<button data-t="${k}" class="${k === orgTab ? "on" : ""}">${l}</button>`).join("");
  el.querySelectorAll("#otabs button").forEach((b) => (b.onclick = () => { orgTab = b.dataset.t; el.querySelector("#obody").innerHTML = ""; T.orgView(el); }));
  await TABS.find(([k]) => k === orgTab)[2](el.querySelector("#obody"));
};

/* ---- employee directory ---- */
const dirState = { q: "", dept: "" };
T.directoryView = async (el) => {
  const people = await T.api("/api/org/directory");
  people.forEach((p) => T.peopleCache.set(p.id, p));
  const depts = [...new Set(people.map((p) => p.department).filter(Boolean))].sort();
  const filtered = () => {
    const q = dirState.q.trim().toLowerCase();
    return people.filter((p) => (!dirState.dept || p.department === dirState.dept)
      && (!q || [p.name, p.designation, p.department, p.teams.join(" "), p.projects.map((x) => x.name).join(" ")].join(" ").toLowerCase().includes(q)));
  };
  const cards = (list) => list.map((p) => `<div class="dcard" data-person="${p.id}" tabindex="0">
      <div class="row" style="gap:12px">${T.avatar(p, "lg")}<div style="min-width:0"><div class="dn">${T.esc(p.name)}</div><div class="muted small">${T.esc(p.designation || "—")}</div><div style="margin-top:6px">${T.statusBadge(p.live_status)}</div></div></div>
      <div class="drow"><span>Department</span><b>${T.esc(p.department || "—")}</b></div>
      <div class="drow"><span>Team</span><b>${T.esc(p.teams.join(", ") || "—")}</b></div>
      <div class="drow"><span>Role</span>${roleBadge(p)}</div>
      <div class="pills" style="margin-top:8px">${p.projects.length ? projectChips(p.projects, 3) : '<span class="muted small">No projects</span>'}</div></div>`).join("") || `<div class="empty" style="grid-column:1/-1">Nobody matches your search</div>`;
  const first = filtered();
  el.innerHTML = `<div class="toolbar"><div class="search">${T.icon("search")}<input class="input" id="dq" placeholder="Search by name, designation, team or project" value="${T.esc(dirState.q)}"></div>
    <select class="input" id="dd" style="width:auto"><option value="">All departments</option>${depts.map((d) => `<option ${d === dirState.dept ? "selected" : ""}>${T.esc(d)}</option>`).join("")}</select>
    <span class="muted small" id="dc">${first.length} of ${people.length} people</span></div><div class="dir-grid" id="dg">${cards(first)}</div>`;
  const draw = () => {
    const list = filtered();
    el.querySelector("#dc").textContent = `${list.length} of ${people.length} people`;
    el.querySelector("#dg").innerHTML = cards(list);
  };
  el.querySelector("#dq").oninput = (e) => { dirState.q = e.target.value; draw(); };
  el.querySelector("#dd").onchange = (e) => { dirState.dept = e.target.value; e.target.blur(); draw(); };
  el.querySelector("#dg").onkeydown = (e) => { const c = e.target.closest(".dcard"); if (c && e.key === "Enter") T.personModal(Number(c.dataset.person)); };
};

/* ---- organization chart ---- */
const collapsed = new Set();
T.orgChartView = async (el) => {
  const nodes = await T.api("/api/org/chart");
  nodes.forEach((n) => T.peopleCache.set(n.id, n));
  const company = T.me?.company || "Company";
  const kids = new Map();
  for (const n of nodes) { const k = n.parent ?? 0; (kids.get(k) || kids.set(k, []).get(k)).push(n); }
  for (const list of kids.values()) list.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const count = (id) => (kids.get(id) || []).reduce((s, c) => s + 1 + count(c.id), 0);
  const node = (n) => {
    const c = kids.get(n.id) || [], shut = collapsed.has(n.id);
    return `<li><div class="onode" data-person="${n.id}" tabindex="0">${T.avatar(n)}<div class="on">${T.esc(n.name)}</div><div class="od">${T.esc(n.designation || roleLabel(n))}</div>
      <div class="row" style="gap:4px;justify-content:center;margin-top:6px">${roleBadge(n)}</div></div>
      ${c.length ? `<button type="button" class="otoggle" data-tog="${n.id}" title="${shut ? "Show" : "Hide"} ${count(n.id)} below">${shut ? "+" + count(n.id) : "−"}</button>${shut ? "" : `<ul>${c.map(node).join("")}</ul>`}` : ""}</li>`;
  };
  // people nobody reports to yet (and who lead nobody) wait in one group instead of cluttering the top level
  const roots = kids.get(0) || [], loose = roots.filter((n) => n.role === "employee" && !kids.has(n.id));
  const top = roots.filter((n) => !loose.includes(n)), shut = collapsed.has(-1);
  const groupNode = `<li><div class="onode company group"><div class="on">Not placed yet</div><div class="od">${loose.length} without a reporting line</div></div>
    <button type="button" class="otoggle" data-tog="-1">${shut ? "+" + loose.length : "−"}</button>${shut ? "" : `<ul>${loose.map(node).join("")}</ul>`}</li>`;
  el.innerHTML = `<div class="card"><div class="card-h"><h3>Organization chart</h3><div class="row" style="gap:8px"><span class="muted small">${nodes.length} people · click anyone to see their profile</span>
    <button class="btn btn-sm" id="oexp">Expand all</button><button class="btn btn-sm" id="ocol">Collapse all</button></div></div>
    <div class="ochart"><ul class="otree"><li><div class="onode company"><div class="on">${T.esc(company)}</div><div class="od">Whole company</div></div>
      <ul>${top.map(node).join("")}${loose.length ? groupNode : ""}</ul></li></ul></div></div>`;
  el.querySelectorAll("[data-tog]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const id = Number(b.dataset.tog); collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id); T.orgChartView(el); }));
  el.querySelector("#oexp").onclick = () => { collapsed.clear(); T.orgChartView(el); };
  el.querySelector("#ocol").onclick = () => { nodes.filter((n) => kids.has(n.id)).forEach((n) => collapsed.add(n.id)); collapsed.add(-1); T.orgChartView(el); };
  el.querySelector(".ochart").onkeydown = (e) => { const c = e.target.closest(".onode[data-person]"); if (c && e.key === "Enter") T.personModal(Number(c.dataset.person)); };
};

/* ---- teams: read-only for everyone, editable where the role has teams.manage ---- */
const teamState = { q: "" };
T.teamsView = async (el) => {
  const { departments, people } = await T.api("/api/org/teams"), manage = canManageTeams();
  departments.forEach((d) => d.teams.forEach((t) => [t.lead, ...t.members].filter(Boolean).forEach((m) => T.peopleCache.set(m.id, m))));
  const personOpts = (sel, none, skip) => [["", none], ...people.filter((p) => p.id !== skip).map((p) => [p.id, `${p.name}${p.designation ? " — " + p.designation : ""}`])].map(([v, l]) => `<option value="${v}" ${String(v) === String(sel ?? "") ? "selected" : ""}>${T.esc(l)}</option>`).join("");
  const q = teamState.q.trim().toLowerCase();
  const teamCard = (t) => `<div class="tcard"><div class="card-h" style="margin-bottom:10px"><div><h3 style="font-size:15px">${T.esc(t.name)}</h3><span class="muted small">${t.members.length} member${t.members.length === 1 ? "" : "s"}</span></div>
      ${manage ? `<div class="row" style="gap:4px"><button class="btn btn-icon" data-team-edit="${t.id}" title="Rename or move team">${T.icon("edit")}</button><button class="btn btn-icon del" data-team-del="${t.id}" title="Delete team">${T.icon("trash")}</button></div>` : ""}</div>
    <div class="tlead"><small class="muted">Team lead</small>${manage ? `<select class="input" data-lead="${t.id}">${personOpts(t.lead?.id, "— No team lead —")}</select>` : (t.lead ? chip(t.lead) : '<div class="muted small">Not assigned</div>')}</div>
    <div class="tmembers">${t.members.map((m) => `<div class="tmem">${chip(m, m.id === t.lead?.id ? "Team Lead" : m.designation)}${manage ? `<button class="btn btn-icon del" data-rm="${t.id}:${m.id}" title="Remove from team">${T.icon("x")}</button>` : ""}</div>`).join("") || '<div class="muted small">No members yet</div>'}</div>
    ${manage ? `<div class="row" style="gap:6px;margin-top:10px"><select class="input" data-add="${t.id}"><option value="">Add a member…</option>${people.filter((p) => !t.members.some((m) => m.id === p.id)).map((p) => `<option value="${p.id}">${T.esc(p.name)}</option>`).join("")}</select></div>` : ""}</div>`;
  const matches = (t) => !q || [t.name, t.lead?.name, ...t.members.map((m) => m.name)].join(" ").toLowerCase().includes(q);
  el.innerHTML = `<div class="toolbar"><div class="search">${T.icon("search")}<input class="input" id="tq" placeholder="Search teams or members" value="${T.esc(teamState.q)}"></div>
    ${manage ? `<button class="btn" id="newDept">${T.icon("plus")}New department</button><button class="btn primary" id="newTeam">${T.icon("plus")}New team</button>` : ""}</div>
    ${departments.map((d) => {
      const teams = d.teams.filter(matches);
      if (q && !teams.length) return "";
      return `<div class="card" style="margin-bottom:18px"><div class="card-h"><div><h3>${T.esc(d.name)}</h3><span class="muted small">${d.teams.length} team${d.teams.length === 1 ? "" : "s"}${d.head ? "" : ""}</span></div>
        <div class="row" style="gap:10px">${d.head ? `<div><small class="muted">Department head</small>${chip(d.head)}</div>` : ""}
        ${manage && d.id ? `<button class="btn btn-icon" data-dept-edit="${d.id}" title="Edit department">${T.icon("edit")}</button><button class="btn btn-icon del" data-dept-del="${d.id}" title="Delete department">${T.icon("trash")}</button>` : ""}</div></div>
        <div class="tgrid">${teams.map(teamCard).join("") || '<div class="muted">No teams in this department yet</div>'}</div></div>`;
    }).join("") || `<div class="card empty">No teams yet${manage ? " — create a department, then add teams to it." : "."}</div>`}
    ${manage ? `<div class="card"><div class="card-h"><h3>Reporting lines</h3><span class="muted small">Who reports to whom — this drives the organization chart</span></div><div class="table-wrap"><table><thead><tr><th>Person</th><th>Role</th><th>Reports to</th></tr></thead><tbody>
      ${people.map((p) => `<tr><td>${chip(p)}</td><td>${roleBadge(p)}</td><td><select class="input" data-boss="${p.id}">${personOpts(p.reports_to, "— Nobody —", p.id)}</select></td></tr>`).join("")}</tbody></table></div></div>` : ""}`;

  const q$ = el.querySelector("#tq");
  q$.oninput = (e) => { teamState.q = e.target.value; clearTimeout(q$.t); q$.t = setTimeout(() => { T.teamsView(el).then(() => { const n = el.querySelector("#tq"); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }); }, 250); };
  if (!manage) return;

  const act = async (fn, ok) => { try { await fn(); if (ok) T.toast(ok); } catch (e) { T.toast(e.message, "err"); } T.reload(); };
  const deptFields = (d = {}) => `<div class="form-grid">${T.field("Department name", "name", d.name || "", "text", "full")}
    <div class="field full"><label>Department head (optional)</label><select class="input" name="head_id">${personOpts(d.head?.id, "— None —")}</select></div></div>`;
  const teamFields = (t = {}) => `<div class="form-grid">${T.field("Team name", "name", t.name || "", "text", "full")}
    <div class="field full"><label>Department</label><select class="input" name="department_id"><option value="">— No department —</option>${departments.filter((x) => x.id).map((x) => `<option value="${x.id}" ${x.id === t.department_id ? "selected" : ""}>${T.esc(x.name)}</option>`).join("")}</select></div>
    ${t.id ? "" : `<div class="field full"><label>Team lead (optional)</label><select class="input" name="lead_id">${personOpts(null, "— None —")}</select></div>`}</div>`;
  el.querySelector("#newDept").onclick = async () => { const f = await T.modal({ title: "New department", body: deptFields(), submit: "Create" }); if (f) act(() => T.api("/api/org/departments", { method: "POST", body: f }), "Department created"); };
  el.querySelector("#newTeam").onclick = async () => { const f = await T.modal({ title: "New team", body: teamFields(), submit: "Create" }); if (f) act(() => T.api("/api/org/teams", { method: "POST", body: f }), "Team created"); };
  el.querySelectorAll("[data-dept-edit]").forEach((b) => (b.onclick = async () => {
    const d = departments.find((x) => x.id == b.dataset.deptEdit);
    const f = await T.modal({ title: "Edit department", body: deptFields(d), submit: "Save" });
    if (f) act(() => T.api(`/api/org/departments/${d.id}`, { method: "PUT", body: f }), "Department updated");
  }));
  el.querySelectorAll("[data-dept-del]").forEach((b) => (b.onclick = async () => {
    const d = departments.find((x) => x.id == b.dataset.deptDel);
    if (await T.confirm("Delete department", `Delete the "${d.name}" department?`)) act(() => T.api(`/api/org/departments/${d.id}`, { method: "DELETE" }), "Department deleted");
  }));
  const teamOf = (id) => departments.flatMap((d) => d.teams).find((t) => t.id == id);
  el.querySelectorAll("[data-team-edit]").forEach((b) => (b.onclick = async () => {
    const t = teamOf(b.dataset.teamEdit);
    const f = await T.modal({ title: "Edit team", body: teamFields(t), submit: "Save" });
    if (f) act(() => T.api(`/api/org/teams/${t.id}`, { method: "PUT", body: f }), "Team updated");
  }));
  el.querySelectorAll("[data-team-del]").forEach((b) => (b.onclick = async () => {
    const t = teamOf(b.dataset.teamDel);
    if (await T.confirm("Delete team", `Delete "${t.name}"? Its members stay in the company; their reporting line to this lead is cleared.`)) act(() => T.api(`/api/org/teams/${t.id}`, { method: "DELETE" }), "Team deleted");
  }));
  el.querySelectorAll("[data-lead]").forEach((s) => (s.onchange = () => { s.blur(); act(() => T.api(`/api/org/teams/${s.dataset.lead}`, { method: "PUT", body: { lead_id: s.value } }), "Team lead updated"); }));
  el.querySelectorAll("[data-add]").forEach((s) => (s.onchange = () => { if (!s.value) return; s.blur(); act(() => T.api(`/api/org/teams/${s.dataset.add}/members`, { method: "POST", body: { user_id: s.value } }), "Member added"); }));
  el.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const [t, u] = b.dataset.rm.split(":"); act(() => T.api(`/api/org/teams/${t}/members/${u}`, { method: "DELETE" }), "Member removed"); }));
  el.querySelectorAll("[data-boss]").forEach((s) => {
    s.onchange = () => { s.blur(); act(() => T.api(`/api/org/reporting/${s.dataset.boss}`, { method: "PUT", body: { reports_to: s.value } }), "Reporting line updated"); };
  });
};

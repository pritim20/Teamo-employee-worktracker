/* Teamo shared helpers: API, UI components, charts, shell */
const T = {};

// Each panel has its own sign-in page: admins/managers use /admin-login, employees use /employee-login.
T.loginUrl = (role) => ((role || (location.pathname.startsWith("/admin") ? "admin" : "employee")) === "admin" ? "/admin-login" : "/employee-login");

T.api = async (url, opts = {}) => {
  const res = await fetch(url, {
    method: opts.method || "GET",
    headers: { "X-Portal": location.pathname.startsWith("/employee") ? "employee" : "admin", ...(opts.body && !(opts.body instanceof FormData) ? { "Content-Type": "application/json" } : {}) },
    body: opts.body instanceof FormData ? opts.body : opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: "same-origin",
  });
  if (res.status === 401) { location.href = T.loginUrl(); throw new Error("Session expired"); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
};

T.esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const P = {
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  check: "M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11",
  clock: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2",
  video: "M23 7l-7 5 7 5V7zM14 5H3a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2z",
  chart: "M18 20V10M12 20V4M6 20v-6",
  cog: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  chat: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h5",
  link: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71",
  upload: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  list: "M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  calendar: "M19 4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM16 2v4M8 2v4M3 10h18",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  plus: "M12 5v14M5 12h14",
  edit: "M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z",
  trash: "M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  x: "M18 6L6 18M6 6l12 12",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.35-4.35",
  menu: "M3 12h18M3 6h18M3 18h18",
  moon: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42",
  tick: "M20 6L9 17l-5-5",
  login: "M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3",
  pin: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  activity: "M22 12h-4l-3 9L9 3l-3 9H2",
  alert: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 8v4M12 16h.01",
  briefcase: "M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4",
  mail: "M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6",
  zap: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
};
T.icon = (n, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24"><path d="${P[n] || ""}"/></svg>`;
T.logo = `<img src="/static/img/logo.png" alt="Teamo">`;

T.initials = (n) => (n || "?").split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
T.avatar = (u, size = "") => `<div class="avatar ${size}" style="background:${u.color || "#6366f1"}">${T.esc(T.initials(u.name))}</div>`;
T.person = (u, sub) => `<div class="person">${T.avatar(u)}<div style="min-width:0"><div class="n">${T.esc(u.name)}</div><div class="d">${T.esc(sub ?? u.designation ?? "")}</div></div></div>`;

const BADGE = {
  Present: "green", Late: "amber", Absent: "red", Leave: "blue", "Not marked": "gray", "Not checked in": "gray",
  Assigned: "amber", "In Progress": "blue", Submitted: "violet", Approved: "green",
  High: "red", Medium: "amber", Low: "gray",
  Available: "green", Busy: "red", "In Meeting": "violet", "On Break": "amber", Away: "gray", Offline: "gray", "Checked out": "cyan",
  Scheduled: "amber", Completed: "green", admin: "violet", manager: "cyan", employee: "gray", Active: "green", Inactive: "red",
};
T.badge = (s) => `<span class="badge b-${BADGE[s] || "gray"}">${T.esc(s)}</span>`;
// live user status: "In Meeting" gets a video icon instead of the plain dot, so it reads at a glance on the dashboard
T.statusBadge = (s) => s === "In Meeting" ? `<span class="badge b-violet ic">${T.icon("video", "i")}${T.esc(s)}</span>` : T.badge(s || "Offline");

T.fmtDate = (d) => d ? new Date(d + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
T.fmtTime = (t) => { if (!t) return "—"; const [h, m] = t.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
// Company time: the server tells us the current time in the company timezone (/api/me), and we keep the
// difference to this device's clock. Everything on screen (top-right clock, "today", hours worked) then agrees
// with the check-in times the server stores, even when the device is set to another timezone.
T.clockOffset = 0;
T.now = () => new Date(Date.now() + T.clockOffset);
T.syncClock = (serverTime) => { const t = serverTime && new Date(serverTime.replace(" ", "T")); if (t && !isNaN(t)) T.clockOffset = t - Date.now(); };
T.today = () => { const d = T.now(), p = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
T.addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };

/* toast */
T.toast = (msg, type = "ok") => {
  let box = document.querySelector(".toasts");
  if (!box) { box = document.createElement("div"); box.className = "toasts"; document.body.appendChild(box); }
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.innerHTML = `${T.icon(type === "err" ? "alert" : "tick")}<span>${T.esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => el.remove(), 3200);
};

/* modal: returns a promise resolving with form data object or null */
T.modal = ({ title, body, submit = "Save", danger = false, wide = false, onOpen }) => new Promise((resolve) => {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<form class="modal" style="${wide ? "max-width:760px" : ""}">
    <div class="modal-h"><h3>${T.esc(title)}</h3><button type="button" class="icon-btn" data-x>${T.icon("x")}</button></div>
    <div class="modal-b">${body}</div>
    <div class="modal-f"><button type="button" class="btn" data-x>Cancel</button>
    ${submit ? `<button class="btn ${danger ? "danger" : "primary"}">${T.esc(submit)}</button>` : ""}</div></form>`;
  const close = (v) => { ov.remove(); resolve(v); };
  ov.addEventListener("click", (e) => { if (e.target === ov || e.target.closest("[data-x]")) close(null); });
  ov.querySelector("form").addEventListener("submit", (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), out = {};
    for (const [k, v] of fd.entries()) {
      if (k.endsWith("[]")) (out[k.slice(0, -2)] ||= []).push(v); else out[k] = v;
    }
    close(out);
  });
  document.body.appendChild(ov);
  onOpen && onOpen(ov);
  ov.querySelector("input,select,textarea")?.focus();
});
T.confirm = (title, text) => T.modal({ title, body: `<p class="muted">${T.esc(text)}</p>`, submit: "Delete", danger: true });

T.field = (label, name, value = "", type = "text", extra = "") =>
  `<div class="field ${extra.includes("full") ? "full" : ""}"><label>${label}</label>${type === "textarea"
    ? `<textarea class="input" name="${name}" rows="3">${T.esc(value)}</textarea>`
    : `<input class="input" name="${name}" type="${type}" value="${T.esc(value)}" ${extra.replace("full", "")}>`}</div>`;
T.select = (label, name, options, value = "", extra = "") =>
  `<div class="field ${extra.replace("disabled", "")}"><label>${label}</label><select class="input" name="${name}" ${extra.includes("disabled") ? "disabled" : ""}>${options.map((o) => {
    const [v, l] = Array.isArray(o) ? o : [o, o];
    return `<option value="${T.esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${T.esc(l)}</option>`;
  }).join("")}</select></div>`;

/* meeting links */
T.where = (loc, expired = false) => {
  const isLink = (loc || "").startsWith("/meet/") || /^https?:\/\//.test(loc || "");
  if (expired && isLink) return `<span class="muted">Meeting ended · link expired</span>`;
  if ((loc || "").startsWith("/meet/")) {
    const url = location.origin + loc + "?as=" + (location.pathname.startsWith("/employee") ? "employee" : "admin");
    return `<a href="${T.esc(url)}" target="_blank" rel="noopener" style="color:var(--brand);font-weight:600;word-break:break-all">${T.esc(location.origin + loc)}</a>`;
  }
  return isLink ? `<a href="${T.esc(loc)}" data-join target="_blank" rel="noopener" style="color:var(--brand);font-weight:600;word-break:break-all">${T.esc(loc)}</a>` : T.esc(loc || "—");
};

/* pre-join check: asks the browser for camera/microphone access, then opens the meeting */
T.joinMeeting = async (url) => {
  let stream = null;
  const f = await T.modal({
    title: "Join meeting", submit: "Join now",
    body: `<div style="background:#0b0d1f;border-radius:14px;overflow:hidden;aspect-ratio:16/9;display:grid;place-items:center;color:#c7d2fe;position:relative">
        <video id="pv" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover;transform:scaleX(-1);display:none"></video>
        <div id="pvmsg" class="small" style="padding:16px;text-align:center">Allow camera and microphone access when your browser asks…</div></div>
      <div class="row" style="gap:20px;margin-top:14px"><label class="row" style="gap:6px"><input type="checkbox" id="cam" checked>Camera on</label>
        <label class="row" style="gap:6px"><input type="checkbox" id="mic" checked>Microphone on</label></div>
      <p class="small muted" style="margin-top:12px">You'll be asked to confirm again on the meeting page. Anyone with the link can join.</p>`,
    onOpen: async (ov) => {
      const msg = ov.querySelector("#pvmsg"), vid = ov.querySelector("#pv");
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        vid.srcObject = stream; vid.style.display = "block"; msg.style.display = "none";
      } catch (e) {
        msg.textContent = "Camera/microphone access was blocked. You can still join and allow access on the meeting page, or enable it in your browser's site settings.";
        ov.querySelector("#cam").checked = ov.querySelector("#mic").checked = false;
      }
      const sync = () => {
        stream?.getVideoTracks().forEach((t) => (t.enabled = ov.querySelector("#cam").checked));
        stream?.getAudioTracks().forEach((t) => (t.enabled = ov.querySelector("#mic").checked));
        vid.style.visibility = ov.querySelector("#cam").checked ? "visible" : "hidden";
      };
      ov.querySelector("#cam").onchange = ov.querySelector("#mic").onchange = sync;
      ov._opts = () => ({ cam: ov.querySelector("#cam").checked, mic: ov.querySelector("#mic").checked });
      ov.querySelector("form").addEventListener("submit", () => { window.__joinOpts = ov._opts(); }, true);
    },
  });
  stream?.getTracks().forEach((t) => t.stop());
  if (!f) return;
  const o = window.__joinOpts || {};
  const hash = `#config.startWithVideoMuted=${!o.cam}&config.startWithAudioMuted=${!o.mic}&config.prejoinConfig.enabled=true`;
  window.open(url + hash, "_blank", "noopener");
};
document.addEventListener("click", (e) => {
  const a = e.target.closest("a[data-join]");
  if (a) { e.preventDefault(); T.joinMeeting(a.href); }
});

/* task discussion: comments between the assignee and the managers */
T.discuss = (id) => new Promise((resolve) => {
  let timer, last = "";
  const draw = async (ov, force) => {
    const d = await T.api(`/api/tasks/${id}/comments`), box = ov.querySelector("#thread");
    const sig = JSON.stringify(d.comments.map((m) => m.id));
    if (!force && sig === last) return;
    last = sig;
    ov.querySelector(".modal-h h3").textContent = `Discussion · ${d.task.title}`;
    const atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 40 || force;
    box.innerHTML = d.comments.map((m) => { const mine = m.user_id === d.me;
      return `<div style="display:flex;flex-direction:column;align-items:${mine ? "flex-end" : "flex-start"};margin-bottom:10px">
        <div class="small muted" style="margin-bottom:2px"><b>${mine ? "You" : T.esc(m.author)}</b> ${m.role === "employee" ? "" : `<span class="badge b-violet">${T.esc(m.role)}</span>`} · ${T.esc(m.ts.slice(5, 16))}</div>
        <div style="max-width:85%;padding:9px 13px;border-radius:14px;white-space:pre-wrap;word-break:break-word;background:${mine ? "var(--brand)" : "var(--surface-2)"};color:${mine ? "#fff" : "inherit"};border:1px solid var(--border)">${T.esc(m.text)}</div></div>`; }).join("")
      || '<div class="muted small" style="text-align:center;padding:30px 0">No messages yet. Ask a question or discuss the requirements.</div>';
    if (atEnd) box.scrollTop = box.scrollHeight;
  };
  T.modal({ title: "Discussion", submit: "", wide: true,
    body: `<div id="thread" style="height:340px;overflow-y:auto;padding:4px 2px"></div>
      <div class="row" style="gap:8px;margin-top:12px;align-items:flex-end"><textarea class="input" id="msg" rows="2" placeholder="Write a message… (Enter to send, Shift+Enter for a new line)" style="flex:1;resize:none"></textarea>
      <button type="button" class="btn primary" id="send">Send</button></div>`,
    onOpen: (ov) => {
      const send = async () => {
        const t = ov.querySelector("#msg"), text = t.value.trim();
        if (!text) return;
        t.disabled = true;
        try { await T.api(`/api/tasks/${id}/comments`, { method: "POST", body: { text } }); t.value = ""; await draw(ov, true); } catch (e) { T.toast(e.message, "err"); }
        t.disabled = false; t.focus();
      };
      ov.querySelector("#send").onclick = send;
      ov.querySelector("#msg").onkeydown = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } };
      draw(ov, true).catch((e) => T.toast(e.message, "err"));
      timer = setInterval(() => draw(ov).catch(() => {}), 3000);
    } }).then(() => { clearInterval(timer); resolve(); });
});
T.discussBtn = (t) => `<button class="btn btn-icon" data-discuss="${t.id}" title="Discussion" aria-label="Discussion">${T.icon("chat")}</button>`;
document.addEventListener("click", (e) => { const b = e.target.closest("[data-discuss]"); if (b) { e.stopPropagation(); T.discuss(b.dataset.discuss).then(() => T.reload && T.reload()); } });

/* task activity history */
T.history = async (id) => {
  const d = await T.api(`/api/tasks/${id}/activity`);
  const ICON = { created: ["plus", "#6366f1"], status: ["clock", "#3b82f6"], submitted: ["tick", "#8b5cf6"], file: ["download", "#06b6d4"], note: ["edit", "#64748b"], changes: ["alert", "#ef4444"], approved: ["check", "#10b981"] };
  await T.modal({ title: `History · ${d.task.title}`, submit: "", wide: true,
    body: d.events.length ? `<div style="position:relative;padding-left:6px">${d.events.map((e) => { const [ic, col] = ICON[e.kind] || ["clock", "#64748b"];
      return `<div style="display:flex;gap:12px;padding:0 0 18px;position:relative"><div style="flex:none;width:30px;height:30px;border-radius:50%;display:grid;place-items:center;background:${col};color:#fff"><span style="width:16px;height:16px;display:block">${T.icon(ic)}</span></div>
        <div style="flex:1;min-width:0"><div><b>${T.esc(e.actor)}</b> ${e.role && e.role !== "employee" ? `<span class="badge b-violet">${T.esc(e.role)}</span> ` : ""}${T.esc(e.text)}</div>
        ${e.detail ? `<div class="small" style="margin-top:4px;padding:7px 10px;border-radius:10px;background:var(--surface-2);border:1px solid var(--border);white-space:pre-wrap;word-break:break-word">${T.esc(e.detail)}</div>` : ""}
        <div class="small muted" style="margin-top:3px">${T.esc((e.ts || "").slice(0, 16))}</div></div></div>`; }).join("")}</div>` : '<div class="empty">No activity yet</div>' });
};
T.historyBtn = (t) => `<button class="btn btn-icon" data-history="${t.id}" title="History" aria-label="History">${T.icon("clock")}</button>`;
document.addEventListener("click", (e) => { const b = e.target.closest("[data-history]"); if (b) { e.stopPropagation(); T.history(b.dataset.history).catch((er) => T.toast(er.message, "err")); } });

/* one task card used everywhere (admin and employee, every status); height follows its content */
T.taskCard = (t, { actions = "", staff = false } = {}) => {
  const open = t.status !== "Approved", late = open && t.due_date < T.today();
  const redo = t.last_feedback_kind === "changes" && ["Assigned", "In Progress"].includes(t.status);
  return `<div class="task-card ${t.status === "Approved" ? "done" : ""}">
    <div class="tc-head"><div class="tc-title">${T.esc(t.title)}</div><div class="tc-badges">${T.badge(t.priority)}${T.badge(t.status)}</div></div>
    ${t.project ? `<div class="small muted" style="margin-top:-4px">${T.icon("list")} ${T.esc(t.project)}</div>` : ""}
    ${t.description ? `<div class="tc-desc">${T.esc(t.description)}</div>` : ""}
    ${redo ? `<div class="small" style="padding:8px 10px;border-radius:10px;background:rgba(239,68,68,.1);color:var(--red)"><b>Changes requested:</b> ${T.esc(t.last_feedback)}</div>` : ""}
    <div class="tc-meta">${staff ? (t.assignee ? `<span class="row" style="gap:8px">${T.avatar({ name: t.assignee, color: t.assignee_color }, "sm")}<span class="small bold">${T.esc(t.assignee)}</span></span>` : '<span class="small muted">Unassigned</span>') : `<span class="small muted">By ${T.esc(t.creator || "—")}</span>`}
      <span class="small ${late ? "" : "muted"}" style="${late ? "color:var(--red);font-weight:700" : ""}">${T.icon("calendar")} Due ${T.fmtDate(t.due_date)}</span></div>
    <div class="task-actions">${T.discussBtn(t)}${T.historyBtn(t)}<span class="sp"></span>${actions}</div></div>`;
};

/* task review helpers */
T.attachments = (list, { removable = false } = {}) => list.length
  ? list.map((a) => `<span class="row" style="gap:4px"><a class="btn" style="padding:4px 10px;font-size:12.5px;max-width:260px" ${a.url ? `href="${T.esc(a.url)}" target="_blank" rel="noopener noreferrer" title="${T.esc(a.url)}"` : `href="/api/attachments/${a.id}" title="Download ${T.esc(a.filename)}"`}>${T.icon(a.url ? "link" : "download")}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${T.esc(a.url ? a.url.replace(/^https?:\/\//, "") : a.filename)}</span></a>
      ${(typeof removable === "function" ? removable(a) : removable) ? `<button type="button" class="btn btn-icon del" style="width:28px;height:28px" data-rmatt="${a.id}" title="Remove" aria-label="Remove">${T.icon("x")}</button>` : ""}</span>`).join(" ")
  : '<span class="muted small">No attachments</span>';
/* paste-link + attach-file fields, shared by the task forms; read back with T.readAttach(overlay) */
T.attachFields = () => `<div class="field full"><label>Attach files (optional, up to 5 files, 10 MB each)</label><input class="input" id="att-files" type="file" multiple></div>
  <div class="field full"><label>Paste links (optional, one per line)</label><textarea class="input" id="att-links" rows="2" placeholder="https://docs.google.com/…"></textarea></div>`;
T.sendAttach = async (taskId, ov) => {
  const files = ov.querySelector("#att-files").files, links = ov.querySelector("#att-links").value.trim();
  if (!files.length && !links) return;
  const fd = new FormData();
  [...files].forEach((x) => fd.append("files", x));
  fd.append("links", links);
  await T.api(`/api/tasks/${taskId}/attachments`, { method: "POST", body: fd });
};
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-rmatt]");
  if (!b) return;
  try { await T.api(`/api/task-attachments/${b.dataset.rmatt}`, { method: "DELETE" }); b.closest("span.row").remove(); T.toast("Attachment removed"); } catch (er) { T.toast(er.message, "err"); }
});
T.feedbackList = (list) => list.map((f) => `<div style="padding:8px 12px;margin-top:8px;border-radius:12px;border:1px solid var(--border);background:var(--surface-2)">
  <div class="small muted"><b>${T.esc(f.author)}</b> ${f.kind === "approved" ? "approved this work" : "requested changes"} · ${T.esc(f.ts.slice(0, 16))}</div>
  ${f.text ? `<div style="white-space:pre-wrap">${T.esc(f.text)}</div>` : ""}</div>`).join("");

/* charts */
T.bars = (data, { alt = false, suffix = "" } = {}) => {
  const max = Math.max(1, ...data.map((d) => d.value));
  return `<div class="bars ${data.length > 12 ? "dense" : ""}">${data.map((d) =>
    `<div class="bar"><div class="col ${alt ? "alt" : ""}" data-v="${d.value}${suffix}" style="height:${Math.max(2, (d.value / max) * 100)}%"></div><div class="x">${T.esc(d.label)}</div></div>`).join("")}</div>`;
};
T.donut = (parts, centerLabel = "Total") => {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = 60, C = 2 * Math.PI * r;
  let off = 0;
  const segs = parts.map((p) => {
    const len = (p.value / total) * C;
    const s = `<circle cx="75" cy="75" r="${r}" fill="none" stroke="${p.color}" stroke-width="16" stroke-dasharray="${Math.max(0, len - 3)} ${C}" stroke-dashoffset="${-off}" stroke-linecap="round" transform="rotate(-90 75 75)"/>`;
    off += len; return s;
  }).join("");
  return `<div class="donut-wrap"><div class="donut"><svg viewBox="0 0 150 150" width="150" height="150">
    <circle cx="75" cy="75" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="16"/>${segs}</svg>
    <div class="center"><div><b>${parts.reduce((a, p) => a + p.value, 0)}</b><small>${centerLabel}</small></div></div></div>
    <div class="legend">${parts.map((p) => `<div><i style="background:${p.color}"></i>${T.esc(p.label)}<span>${p.value}</span></div>`).join("")}</div></div>`;
};
T.stat = (label, value, icon, color, foot = "") =>
  `<div class="card stat c-${color}"><div class="top"><div class="ico">${T.icon(icon)}</div></div>
   <div><div class="val">${value}</div><div class="lbl">${label}</div></div>${foot ? `<div class="foot">${foot}</div>` : ""}</div>`;

/* theme */
T.applyTheme = () => {
  let t = "light";
  try { t = localStorage.getItem("teamo-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); } catch (e) {}
  document.documentElement.dataset.theme = t;
};
T.toggleTheme = () => {
  const t = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("teamo-theme", t); } catch (e) {}
  document.querySelector("#themeBtn").innerHTML = T.icon(t === "dark" ? "sun" : "moon");
};
T.applyTheme();

/* shell: builds sidebar + topbar, routes by hash */
T.shell = ({ me, nav, views, tagline }) => {
  const root = document.getElementById("app");
  const items = nav.filter((n) => !n.perm || me.perms.includes(n.perm));
  root.innerHTML = `<div class="app">
    <aside class="sidebar" id="sidebar">
      <div class="brand"><div class="brand-mark" id="brandMark" title="Click to collapse, double-click to expand" style="cursor:pointer">${T.logo}</div><div class="brand-text"><div class="brand-name">Teamo</div><div class="brand-tag">${T.esc(tagline)}</div></div></div>
      <div class="nav-label">Menu</div>
      <nav class="nav">${items.map((n) => `<a data-view="${n.id}" title="${T.esc(n.label)}">${T.icon(n.icon)}<span>${n.label}</span></a>`).join("")}
        <a class="logout" id="logoutBtn" title="Logout">${T.icon("logout")}<span>Logout</span></a></nav>
      <div class="side-card">${T.avatar(me.user)}<div><div class="who">${T.esc(me.user.name)}</div><div class="role">${T.esc(me.user.role)} · ${T.esc(me.user.department)}</div></div></div>
    </aside>
    <div class="scrim" id="scrim"></div>
    <main class="main">
      <header class="topbar">
        <button class="icon-btn menu-btn" id="menuBtn">${T.icon("menu")}</button>
        <div><h1 id="pageTitle">Dashboard</h1><div class="sub" id="pageSub"></div></div>
        <div class="spacer"></div>
        <div class="clock" title="Company time${T.timezone ? " (" + T.timezone + ")" : ""}">${T.icon("clock")}<b id="clockT"></b><span id="clockD"></span></div>
        <button class="icon-btn" id="themeBtn" title="Toggle theme">${T.icon(document.documentElement.dataset.theme === "dark" ? "sun" : "moon")}</button>
      </header>
      <section class="content" id="view"></section>
    </main></div>`;

  const tick = () => {
    const d = T.now();
    document.getElementById("clockT").textContent = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    document.getElementById("clockD").textContent = d.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });
  };
  tick(); setInterval(tick, 15000);

  const sb = document.getElementById("sidebar"), scrim = document.getElementById("scrim");
  const closeNav = () => { sb.classList.remove("open"); scrim.classList.remove("open"); };
  document.getElementById("menuBtn").onclick = () => { sb.classList.add("open"); scrim.classList.add("open"); };
  scrim.onclick = closeNav;
  // click the logo to collapse the sidebar to icons, double-click it to expand again
  const setCollapsed = (v) => { sb.classList.toggle("collapsed", v); try { localStorage.setItem("teamo-sb", v ? "1" : "0"); } catch (e) { /* ignore */ } };
  try { setCollapsed(localStorage.getItem("teamo-sb") === "1"); } catch (e) { /* ignore */ }
  const mark = document.getElementById("brandMark");
  mark.onclick = () => setCollapsed(true);
  mark.ondblclick = () => setCollapsed(false);
  document.getElementById("themeBtn").onclick = T.toggleTheme;
  document.getElementById("logoutBtn").onclick = async () => { await T.api("/api/logout", { method: "POST" }); location.href = T.loginUrl(); };
  root.querySelectorAll(".nav a[data-view]").forEach((a) => (a.onclick = () => { location.hash = a.dataset.view; closeNav(); }));

  // live updates: a Supabase Realtime broadcast fires on every write anywhere in the
  // app (server/db.js's execute() sends it), replacing the old /api/pulse version-number
  // poll — which can't exist as written server-side anyway, since Netlify Functions don't
  // share process memory between invocations the way the old DATA_VERSION global did.
  // Bursts of writes (e.g. saving several settings keys at once) are coalesced into one
  // re-render, and a re-render never interrupts active typing or an open dialog.
  let activeItem = null, activeView = null, pulseDebounce;
  const triggerLiveRefresh = () => {
    if (!activeItem || !activeView || document.hidden) return;
    const a = document.activeElement;
    if (document.querySelector(".overlay") || (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    views[activeItem.id](activeView).catch(() => {});
  };
  (async () => {
    try {
      const cfg = await fetch("/api/public-config").then((r) => r.json());
      window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key)
        .channel("pulse")
        .on("broadcast", { event: "changed" }, () => { clearTimeout(pulseDebounce); pulseDebounce = setTimeout(triggerLiveRefresh, 400); })
        .subscribe();
    } catch (e) { /* live updates are a nice-to-have; views still work without them */ }
  })();
  // A broadcast that arrives while this tab is in the background is deliberately skipped
  // (triggerLiveRefresh's document.hidden check) to avoid wasted work — but nothing then
  // retroactively catches it up, so without this the view would sit stale until some
  // unrelated future change happens to fire another broadcast, or the user refreshes by
  // hand. Catch up once, right when the tab becomes visible again.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) triggerLiveRefresh(); });

  let refreshTimer;
  const route = async () => {
    clearInterval(refreshTimer);
    activeItem = null; activeView = null;
    const id = location.hash.slice(1) || items[0].id;
    const item = items.find((n) => n.id === id) || items[0];
    root.querySelectorAll(".nav a[data-view]").forEach((a) => a.classList.toggle("active", a.dataset.view === item.id));
    document.getElementById("pageTitle").textContent = item.title || item.label;
    document.getElementById("pageSub").textContent = item.sub || "";
    const view = document.getElementById("view");
    view.innerHTML = `<div class="grid g-4">${'<div class="skeleton"></div>'.repeat(4)}</div>`;
    try {
      await views[item.id](view);
      view.firstElementChild?.classList.add("view");
      activeItem = item; activeView = view;
      if (item.refresh) refreshTimer = setInterval(() => views[item.id](view).catch(() => {}), item.refresh);
    } catch (e) {
      view.innerHTML = `<div class="card empty">${T.icon("alert")}<p class="mt">${T.esc(e.message)}</p></div>`;
    }
  };
  T.reload = route;
  window.addEventListener("hashchange", route);
  route();
};

T.boot = async (expected, start) => {
  try {
    const me = await T.api("/api/me");
    T.syncClock(me.server_time); T.timezone = me.timezone;
    if (expected === "employee" ? me.user.role !== "employee" : me.user.role === "employee") { location.href = T.loginUrl(expected === "employee" ? "employee" : "admin"); return; }
    start(me);
  } catch (e) { location.href = T.loginUrl(expected === "employee" ? "employee" : "admin"); }
};

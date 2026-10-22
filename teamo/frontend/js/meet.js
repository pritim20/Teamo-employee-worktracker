/* Teamo Meet: in-house video meetings. Media is WebRTC peer-to-peer (mesh); signalling
   (who's in the room, mic/cam/hand/sharing state, offer/answer/ICE, reactions) travels
   browser-to-browser over Supabase Realtime Presence + Broadcast on a channel named
   after the room code — this server only still gates host-authorized actions (admit,
   force-mute, remove, end) and persists chat, exactly like room_guard() did before. */
(() => {
  const code = location.pathname.split("/").pop();
  const qs = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
  const IC = {
    mic: svg('<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>'),
    micOff: svg('<path d="M1 1l22 22"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/><path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23M12 19v4M8 23h8"/>'),
    cam: svg('<path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2"/>'),
    camOff: svg('<path d="M16 16v1a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2m5.66 0H14a2 2 0 0 1 2 2v3.34l1 1L23 7v10"/><path d="M1 1l22 22"/>'),
    screen: svg('<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/>'),
    users: svg('<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
    chat: svg('<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'),
    leave: svg('<path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7 2 2 0 0 1 1.72 2v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.42 19.42 0 0 1-3.33-2.67m-2.67-3.34a19.79 19.79 0 0 1-3.07-8.63A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/><path d="M23 1L1 23"/>'),
    react: svg('<circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>'),
  };
  IC.callEnd = IC.leave; // same "hang up" glyph as the Leave button, reused for host-remove
  const REACTIONS = ["👍", "❤️", "😂", "👏", "🎉", "😮", "🙌", "🤔"]; // must match the server's REACTIONS allow-list

  let portal = qs.get("as") || "admin";
  async function api(path, opts = {}) {
    const r = await fetch(`/api/rooms/${code}${path}`, {
      method: opts.method || "GET", credentials: "same-origin",
      headers: { "X-Portal": portal, ...(opts.body ? { "Content-Type": "application/json" } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.error || "Something went wrong"); e.status = r.status; throw e; }
    return d;
  }

  /* ---------- state ---------- */
  let info, pid = null, chatSince = 0, roster = [], lobby = [], active = false, joinedAt = 0, ice = [];
  let sb = null, channel = null;
  const local = { audio: null, video: null, screen: null };
  let micOn = true, camOn = true, sharing = false, hand = false, tab = "people", panelOpen = false, unread = 0;
  const peers = {}; // peerId -> { pc, stream, pending }
  const gate = (html, cls = "") => { $("gate").style.display = "grid"; $("room").classList.remove("on"); $("gatebox").className = "panel" + (cls ? " " + cls : ""); $("gatebox").innerHTML = `<div class="brand"><img src="/static/img/logo.png" alt="">Teamo Meet</div>${html}`; };

  /* ---------- local media ---------- */
  const mediaWhy = (name) => why({ name }, "audio").replace("microphone", "camera or microphone");
  async function getLocal() {
    if (!navigator.mediaDevices?.getUserMedia) return "Your browser blocked camera access on this page. Open Teamo over https or on localhost to use camera and microphone.";
    let s = null, err = "";
    for (const c of [{ audio: true, video: true }, { audio: true }, { video: true }]) {
      try { s = await navigator.mediaDevices.getUserMedia(c); break; } catch (e) { err = e.name; }
    }
    if (!s) return mediaWhy(err);
    local.audio = s.getAudioTracks()[0] || null;
    local.video = s.getVideoTracks()[0] || null;
    return "";
  }
  const why = (e, kind) => {
    const n = kind === "audio" ? "microphone" : "camera";
    if (!window.isSecureContext) return `The ${n} only works on a secure page. Open Teamo with https:// (or localhost), not a plain http:// address.`;
    return ({ NotAllowedError: `The ${n} is blocked. Click the lock/camera icon in the address bar, allow ${n} access, then try again.`,
      NotFoundError: `No ${n} was found on this device.`, NotReadableError: `The ${n} is being used by another app or browser tab. Close it there, then try again.`,
      OverconstrainedError: `The ${n} can't be used right now.` })[e?.name] || `The ${n} isn't available (${e?.name || "unknown error"}).`;
  };
  function flash(text, ms = 6000) {
    const el = document.createElement("div");
    el.style.cssText = "position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:20;background:#1b1d3a;border:1px solid #8b5cf6;color:#fff;padding:12px 18px;border-radius:14px;max-width:min(520px,92vw);box-shadow:0 10px 30px rgba(0,0,0,.5);font-size:14px";
    el.textContent = text; document.body.appendChild(el); setTimeout(() => el.remove(), ms);
  }
  // when a device wasn't available at join time, clicking its button tries again and explains any failure
  async function ensureTrack(kind) {
    if (local[kind === "audio" ? "audio" : "video"]) return true;
    if (!navigator.mediaDevices?.getUserMedia) { flash(why(null, kind)); return false; }
    try {
      const s = await navigator.mediaDevices.getUserMedia(kind === "audio" ? { audio: true } : { video: true });
      if (kind === "audio") {
        local.audio = s.getAudioTracks()[0];
        Object.values(peers).forEach((e) => { const t = e.pc.getTransceivers().find((x) => x.receiver.track.kind === "audio"); t && t.sender.replaceTrack(local.audio).catch(() => {}); });
      } else { local.video = s.getVideoTracks()[0]; if (!sharing) setVideoOut(local.video); }
      return true;
    } catch (e) { flash(why(e, kind)); return false; }
  }
  const stopLocal = () => { [local.audio, local.video, local.screen].forEach((t) => t && t.stop()); local.audio = local.video = local.screen = null; };
  const outVideo = () => local.screen || local.video;

  /* ---------- gate: access & pre-join ---------- */
  async function start() {
    const order = qs.get("as") ? [qs.get("as")] : ["admin", "employee"];
    let lastErr;
    for (const p of order) {
      portal = p;
      try { info = await api("/info"); break; } catch (e) { lastErr = e; if (e.status !== 401) break; }
    }
    if (!info) {
      return gate(lastErr?.status === 401
        ? `<h1>Sign in to join</h1><p class="muted" style="margin:8px 0 18px">Sign in to Teamo first, then open this meeting link again.</p><a class="btn primary" href="/" style="text-decoration:none;display:inline-block">Go to sign in</a>`
        : `<h1>Can't open this meeting</h1><p class="muted" style="margin-top:8px">${esc(lastErr?.message || "Meeting room not found")}</p>`);
    }
    ice = info.ice || [];
    access();
  }
  async function access() {
    if (!info.host && info.state === "Completed") return gate(`<h1>${esc(info.title)}</h1><p class="muted" style="margin-top:8px">This meeting has ended. The link is no longer active.</p>`);
    if (info.access === "closed") return gate(`<h1>${esc(info.title)}</h1><p class="muted" style="margin-top:8px">This meeting room opens on ${esc(info.date)}.</p>`);
    if (info.access === "none" || info.access === "denied") {
      return gate(`<h1>${esc(info.title)}</h1><p class="muted" style="margin:8px 0 18px">${info.access === "denied" ? "Your last request was declined. " : ""}Ask the host to let you in.</p><button class="btn primary" id="req">Request to join</button>`),
        ($("req").onclick = async () => { try { await api("/request", { method: "POST" }); info.access = "pending"; access(); } catch (e) { alert(e.message); } });
    }
    if (info.access === "pending") {
      gate(`<h1>${esc(info.title)}</h1><p class="muted" style="margin-top:8px">Waiting for the host to let you in…</p>`);
      while (info.access === "pending") { await sleep(3000); try { info = { ...info, ...(await api("/info")) }; } catch (e) { /* keep waiting */ } }
      return access();
    }
    prejoin();
  }
  async function prejoin() {
    gate(`<div class="prejoin-wrap">
        <div class="preview"><video id="pv" autoplay muted playsinline style="display:none"></video>
          <div class="avatar-big" id="pvAvatar" style="display:none"></div>
          <div id="pvmsg" class="muted" style="padding:20px;text-align:center">Allow camera and microphone access when your browser asks…</div>
          <div class="preview-controls"><button type="button" class="cb" id="pMic" title="Microphone"></button><button type="button" class="cb" id="pCam" title="Camera"></button></div>
        </div>
        <div class="prejoin-info"><h1>${esc(info.title)}</h1><p class="muted">${esc(info.date)} · ${esc(info.start)} – ${esc(info.end)}</p>
          <button class="btn primary lg" id="go">Join now</button></div>
      </div>`, "prejoin");
    const msg = await getLocal();
    micOn = !!local.audio; camOn = !!local.video;
    if (local.audio) local.audio.enabled = micOn;
    if (local.video) local.video.enabled = camOn;
    const updatePreview = () => {
      if (local.video && camOn) { $("pv").srcObject = new MediaStream([local.video]); $("pv").style.display = "block"; $("pvAvatar").style.display = "none"; $("pvmsg").style.display = "none"; }
      else {
        $("pv").style.display = "none"; $("pvAvatar").style.display = "grid";
        $("pvAvatar").style.background = info.me.color || "#6366f1"; $("pvAvatar").textContent = (info.me.name || "?")[0].toUpperCase();
        $("pvmsg").style.display = local.video ? "none" : "block"; $("pvmsg").textContent = local.video ? "" : (msg || "Camera is off");
      }
    };
    const updateControls = () => {
      $("pMic").innerHTML = micOn ? IC.mic : IC.micOff; $("pMic").classList.toggle("off", !micOn); $("pMic").disabled = !local.audio;
      $("pCam").innerHTML = camOn ? IC.cam : IC.camOff; $("pCam").classList.toggle("off", !camOn); $("pCam").disabled = !local.video;
    };
    updatePreview(); updateControls();
    $("pMic").onclick = () => { if (!local.audio) return; micOn = !micOn; local.audio.enabled = micOn; updateControls(); };
    $("pCam").onclick = () => { if (!local.video) return; camOn = !camOn; local.video.enabled = camOn; updatePreview(); updateControls(); };
    $("go").onclick = () => join();
  }

  /* ---------- joining ---------- */
  async function join() {
    $("go").disabled = true;
    try {
      const j = await api("/join", { method: "POST" });
      pid = j.peer; chatSince = j.chat_since; active = true; joinedAt = Date.now();
      if (local.audio) local.audio.enabled = micOn;
      if (local.video) local.video.enabled = camOn;
      $("gate").style.display = "none"; $("room").classList.add("on");
      $("mtitle").textContent = info.title; $("bEnd").style.display = info.host ? "" : "none";
      buildBar(); if (!local.audio || !local.video) flash(`${!local.audio && !local.video ? "Your camera and microphone aren't" : !local.audio ? "Your microphone isn't" : "Your camera isn't"} available. Click the button to try again.`, 7000);
      $("chat").innerHTML = ""; j.history.forEach(addChat); unread = 0; updateDot();
      roster = [];
      renderTiles(); renderPeople();
      await setupRealtime();
      tickTimer();
    } catch (e) { $("go").disabled = false; alert(e.message); }
  }

  /* ---------- Supabase Realtime: presence (roster) + broadcast (signalling) ---------- */
  async function setupRealtime() {
    const cfg = await fetch("/api/public-config").then((r) => r.json());
    sb = window.supabase.createClient(cfg.supabase_url, cfg.supabase_anon_key);
    channel = sb.channel(`room:${code}`, { config: { presence: { key: pid } } });

    channel.on("presence", { event: "sync" }, syncRoster);
    channel.on("broadcast", { event: "signal" }, ({ payload }) => { if (payload.to === pid) onSignal(payload); });
    channel.on("broadcast", { event: "force-mic" }, ({ payload }) => {
      if (payload.peer !== pid) return;
      micOn = payload.on && !!local.audio; if (local.audio) local.audio.enabled = micOn;
      updateBar(); renderTiles(); pushState();
      flash(payload.on ? "The host turned your microphone on." : "The host muted your microphone.");
    });
    channel.on("broadcast", { event: "removed" }, ({ payload }) => {
      if (payload.peer !== pid || !active) return;
      active = false; api("/leave", { method: "POST" }).catch(() => {});
      left("You were removed from the meeting by the host.", true);
    });
    channel.on("broadcast", { event: "ended" }, () => {
      if (!active) return;
      active = false; api("/leave", { method: "POST" }).catch(() => {});
      left("The host ended this meeting.", false);
    });
    channel.on("broadcast", { event: "reaction" }, ({ payload }) => showReaction(payload));
    channel.on("postgres_changes", { event: "INSERT", schema: "public", table: "room_chat", filter: `room_code=eq.${code}` }, ({ new: m }) => {
      if (m.id <= chatSince) return;
      chatSince = Math.max(chatSince, m.id);
      const msg = { id: m.id, name: m.name, user_id: m.user_id, text: m.text, time: (m.ts || "").slice(11, 16) };
      addChat(msg);
      if (!(panelOpen && tab === "chat") && msg.user_id !== info.me.id) { unread++; updateDot(); }
    });

    await channel.subscribe();
    await pushState();
    if (info.host) lobbyLoop();
  }
  function syncRoster() {
    const state = channel.presenceState();
    roster = Object.entries(state).map(([peer, metas]) => ({ peer, ...metas[metas.length - 1] }));
    // mesh WebRTC: avoid a double-offer race by having the lexically-lower peer id always offer
    roster.forEach((p) => { if (p.peer !== pid && !peers[p.peer] && pid < p.peer) connect(p.peer, true); });
    reconcile(); renderTiles(); renderPeople();
  }
  function pushState() {
    return channel?.track({ user_id: info.me.id, name: info.me.name, color: info.me.color, role: info.me.role, host: info.host, mic: micOn, cam: camOn, hand, sharing }) || Promise.resolve();
  }
  async function lobbyLoop() {
    while (active && info.host) {
      try { lobby = await api("/lobby"); renderPeople(); } catch (e) { /* transient; retry next tick */ }
      await sleep(4000);
    }
  }

  /* ---------- WebRTC mesh ---------- */
  const sig = (to, type, data) => channel?.send({ type: "broadcast", event: "signal", payload: { from: pid, to, type, data } });
  function attachLocal(pc) {
    pc.getTransceivers().forEach((t) => {
      const track = t.receiver.track.kind === "audio" ? local.audio : outVideo();
      t.sender.replaceTrack(track || null).catch(() => {});
    });
  }
  function makePC(rpid, offerer) {
    const old = peers[rpid]; if (old?.pc) old.pc.close();
    const pc = new RTCPeerConnection({ iceServers: ice });
    const e = (peers[rpid] = { pc, stream: new MediaStream(), pending: [] });
    if (offerer) { pc.addTransceiver("audio", { direction: "sendrecv" }); pc.addTransceiver("video", { direction: "sendrecv" }); attachLocal(pc); }
    pc.onicecandidate = (ev) => ev.candidate && sig(rpid, "candidate", ev.candidate.toJSON());
    pc.ontrack = (ev) => { e.stream.addTrack(ev.track); ev.track.onunmute = renderTiles; renderTiles(); };
    return pc;
  }
  async function connect(rpid, offerer) {
    const pc = makePC(rpid, offerer);
    if (!offerer) return pc;
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    sig(rpid, "offer", pc.localDescription.toJSON());
    return pc;
  }
  async function flush(e) { for (const c of e.pending.splice(0)) await e.pc.addIceCandidate(c).catch(() => {}); }
  async function onSignal(s) {
    try {
      if (s.type === "offer") {
        const pc = makePC(s.from, false), e = peers[s.from];
        await pc.setRemoteDescription(s.data);
        pc.getTransceivers().forEach((t) => (t.direction = "sendrecv"));
        attachLocal(pc);
        await pc.setLocalDescription(await pc.createAnswer());
        sig(s.from, "answer", pc.localDescription.toJSON());
        await flush(e);
      } else if (s.type === "answer") {
        const e = peers[s.from]; if (!e) return;
        await e.pc.setRemoteDescription(s.data); await flush(e);
      } else if (s.type === "candidate") {
        const e = peers[s.from]; if (!e) return;
        if (e.pc.remoteDescription) await e.pc.addIceCandidate(s.data).catch(() => {}); else e.pending.push(s.data);
      }
    } catch (err) { console.warn("signal", err); }
  }
  function reconcile() {
    const ids = new Set(roster.map((p) => p.peer));
    Object.keys(peers).forEach((id) => { if (!ids.has(id)) { peers[id].pc.close(); delete peers[id]; } });
  }
  const setVideoOut = (track) => Object.values(peers).forEach((e) => {
    const t = e.pc.getTransceivers().find((x) => x.receiver.track.kind === "video");
    t && t.sender.replaceTrack(track || null).catch(() => {});
  });

  /* ---------- UI ---------- */
  function updateBar() {
    $("bMic").innerHTML = micOn ? IC.mic : IC.micOff; $("bMic").classList.toggle("off", !micOn);
    $("bCam").innerHTML = camOn ? IC.cam : IC.camOff; $("bCam").classList.toggle("off", !camOn);
    $("bShare").innerHTML = IC.screen; $("bShare").classList.toggle("active", sharing);
    $("bHand").textContent = "✋"; $("bHand").classList.toggle("active", hand);
    $("bReact").innerHTML = IC.react;
    $("bPeople").innerHTML = IC.users; $("bPeople").classList.toggle("active", panelOpen && tab === "people");
  }
  function buildBar() {
    $("bChat").innerHTML = IC.chat + '<span class="dot" id="chatDot"></span>'; $("bLeave").innerHTML = IC.leave;
    $("bMic").onclick = async () => {
      if (!local.audio) { if (!(await ensureTrack("audio"))) return; micOn = true; } else micOn = !micOn;
      local.audio.enabled = micOn; updateBar(); pushState(); renderTiles();
    };
    $("bCam").onclick = async () => {
      if (!local.video) { if (!(await ensureTrack("video"))) return; camOn = true; } else camOn = !camOn;
      local.video.enabled = camOn; updateBar(); pushState(); renderTiles();
    };
    $("bHand").onclick = () => { hand = !hand; updateBar(); pushState(); };
    $("bReact").onclick = (ev) => { ev.stopPropagation(); toggleReactionPicker(); };
    $("bShare").onclick = async () => {
      if (sharing) return stopShare();
      if (!navigator.mediaDevices?.getDisplayMedia) return alert("Screen sharing isn't available in this browser.");
      try {
        const s = await navigator.mediaDevices.getDisplayMedia({ video: true });
        local.screen = s.getVideoTracks()[0]; local.screen.onended = stopShare;
        sharing = true; setVideoOut(local.screen); updateBar(); pushState(); renderTiles();
      } catch (e) { /* cancelled */ }
    };
    function stopShare() {
      if (!sharing) return;
      local.screen && local.screen.stop(); local.screen = null; sharing = false;
      setVideoOut(local.video); updateBar(); pushState(); renderTiles();
    }
    const panel = (t) => { if (panelOpen && tab === t) panelOpen = false; else { panelOpen = true; tab = t; } showPanel(); updateBar(); };
    $("bPeople").onclick = () => panel("people"); $("bChat").onclick = () => panel("chat");
    document.querySelectorAll(".tabs button").forEach((b) => (b.onclick = () => { tab = b.dataset.t; showPanel(); updateBar(); }));
    $("bLeave").onclick = () => { try { leave(); } catch (e) { /* still leave the screen */ } left("You left the meeting.", true); };
    $("bEnd").onclick = async () => { if (confirm("End this meeting for everyone?")) { await api("/end", { method: "POST" }).catch(() => {}); active = false; left("You ended the meeting for everyone.", false); } };
    $("chatbox").onsubmit = async (e) => {
      e.preventDefault(); const t = $("chatin").value.trim(); if (!t) return;
      $("chatin").value = ""; api("/chat", { method: "POST", body: { text: t } }).catch((er) => alert(er.message));
    };
    updateBar();
  }

  /* ---------- emoji reactions ---------- */
  function toggleReactionPicker() {
    const existing = $("picker");
    if (existing) return existing.remove();
    const box = document.createElement("div"); box.id = "picker";
    box.innerHTML = REACTIONS.map((e) => `<button type="button">${e}</button>`).join("");
    document.body.appendChild(box);
    const r = $("bReact").getBoundingClientRect();
    box.style.left = Math.max(10, Math.min(window.innerWidth - box.offsetWidth - 10, r.left - 90)) + "px";
    box.style.bottom = (window.innerHeight - r.top + 10) + "px";
    box.querySelectorAll("button").forEach((b, i) => (b.onclick = () => { sendReaction(REACTIONS[i]); box.remove(); }));
    setTimeout(() => document.addEventListener("click", function onDoc(ev) { if (!box.contains(ev.target)) { box.remove(); document.removeEventListener("click", onDoc); } }), 0);
  }
  function sendReaction(emoji) {
    api("/react", { method: "POST", body: { emoji } }).catch((e) => flash(e.message));
  }
  function showReaction(x) {
    const stage = $("stage"), el = document.createElement("div");
    el.className = "reaction";
    el.style.left = (15 + Math.random() * 60) + "%";
    el.innerHTML = `<span class="e">${x.emoji}</span><span class="who">${esc(x.user_id === info.me.id ? "You" : x.name)}</span>`;
    stage.appendChild(el);
    setTimeout(() => el.remove(), 2500);
  }
  function showPanel() {
    $("side").classList.toggle("on", panelOpen);
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.t === tab));
    $("people").style.display = tab === "people" ? "" : "none"; $("chat").style.display = tab === "chat" ? "" : "none";
    $("chatbox").style.display = tab === "chat" ? "flex" : "none";
    if (tab === "chat" && panelOpen) { unread = 0; updateDot(); $("chat").scrollTop = 1e9; }
  }
  const updateDot = () => { const d = $("chatDot"); if (d) { d.style.display = unread ? "grid" : "none"; d.textContent = unread; } };
  function addChat(m) {
    const box = $("chat"), atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 60, mine = m.user_id === info.me.id;
    box.insertAdjacentHTML("beforeend", `<div class="msg ${mine ? "mine" : ""}"><b>${mine ? "You" : esc(m.name)}</b><span>${esc(m.time)}</span><p>${esc(m.text)}</p></div>`);
    if (atEnd) box.scrollTop = box.scrollHeight;
  }
  function renderPeople() {
    const lob = info.host && lobby.length ? `<div style="margin-bottom:14px"><div class="muted" style="margin-bottom:6px">Waiting to join</div>${lobby.map((l) => `<div class="person"><div class="avatar" style="background:${esc(l.color)}">${esc(l.name[0])}</div><div style="flex:1">${esc(l.name)}</div>
        <button class="btn primary" style="padding:6px 12px" data-adm="${l.user_id}:approve">Admit</button><button class="btn" style="padding:6px 12px" data-adm="${l.user_id}:deny">Deny</button></div>`).join("")}</div>` : "";
    $("people").innerHTML = lob + `<div class="muted" style="margin-bottom:6px">In this meeting (${roster.length})</div>` + roster.map((p) => { const mod = info.host && p.peer !== pid && !p.host;
      return `<div class="person"><div class="avatar" style="background:${esc(p.color)}">${esc(p.name[0])}</div>
      <div style="flex:1;min-width:0">${esc(p.name)}${p.peer === pid ? " (you)" : ""}${p.host ? ' <span class="muted">· host</span>' : ""}</div>${p.hand ? "✋" : ""}<span style="width:18px;opacity:.7">${p.mic ? "" : IC.micOff}</span>
      ${mod ? `<div class="row" style="gap:4px"><button type="button" class="pbtn" data-mic="${p.peer}" data-on="${p.mic ? 0 : 1}" title="${p.mic ? `Mute ${esc(p.name)}'s mic` : `Unmute ${esc(p.name)}'s mic`}">${p.mic ? IC.mic : IC.micOff}</button>
        <button type="button" class="pbtn danger" data-remove="${p.peer}" data-uid="${p.user_id}" title="Remove ${esc(p.name)} from the meeting">${IC.callEnd}</button></div>` : ""}</div>`; }).join("");
    $("people").querySelectorAll("[data-adm]").forEach((b) => (b.onclick = () => { const [uid, decision] = b.dataset.adm.split(":"); api("/admit", { method: "POST", body: { user_id: Number(uid), decision } }).catch((e) => alert(e.message)); }));
    $("people").querySelectorAll("[data-mic]").forEach((b) => (b.onclick = () => api(`/mic/${b.dataset.mic}`, { method: "POST", body: { on: b.dataset.on === "1" } }).catch((e) => flash(e.message))));
    $("people").querySelectorAll("[data-remove]").forEach((b) => (b.onclick = async () => {
      if (!confirm("Remove this person from the meeting? They'll need to request to join again.")) return;
      api(`/remove/${b.dataset.remove}`, { method: "POST", body: { user_id: Number(b.dataset.uid) || undefined } }).catch((e) => flash(e.message));
    }));
  }
  const tiles = {};
  function renderTiles() {
    const grid = $("grid"), ids = new Set(roster.map((p) => p.peer));
    Object.keys(tiles).forEach((id) => { if (!ids.has(id)) { tiles[id].remove(); delete tiles[id]; } });
    roster.forEach((p) => {
      const mine = p.peer === pid;
      let t = tiles[p.peer];
      if (!t) {
        t = tiles[p.peer] = document.createElement("div");
        t.className = "tile" + (mine ? " me" : "");
        t.innerHTML = `<div class="avatar"></div><video autoplay playsinline ${mine ? "muted" : ""}></video><div class="label"></div><div class="hand"></div>`;
        grid.appendChild(t);
      }
      const vid = t.querySelector("video"), isMic = mine ? micOn : p.mic, isCam = mine ? camOn : p.cam, isShare = mine ? sharing : p.sharing;
      const stream = mine ? (outVideo() ? new MediaStream([outVideo()]) : null) : peers[p.peer]?.stream;
      if (mine) { if (vid._t !== outVideo()) { vid.srcObject = stream; vid._t = outVideo(); } } else if (stream && vid.srcObject !== stream) vid.srcObject = stream;
      const hasVideo = stream && stream.getVideoTracks().length > 0 && (isCam || isShare);
      vid.style.display = hasVideo ? "block" : "none";
      t.classList.toggle("share", !!isShare);
      const av = t.querySelector(".avatar"); av.style.background = p.color; av.textContent = (p.name || "?")[0]; av.style.display = hasVideo ? "none" : "grid";
      t.querySelector(".label").innerHTML = `${isMic ? "" : IC.micOff}${esc(p.name)}${mine ? " (you)" : ""}${isShare ? " · presenting" : ""}`;
      t.querySelector(".hand").textContent = p.hand || (mine && hand) ? "✋" : "";
    });
    const n = roster.length; grid.style.setProperty("--cols", n <= 1 ? 1 : n <= 4 ? 2 : n <= 9 ? 3 : 4);
  }
  function tickTimer() {
    const f = () => { if (!active) return; const s = Math.floor((Date.now() - joinedAt) / 1000); $("timer").textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; setTimeout(f, 1000); };
    f();
  }
  function leave() {
    if (pid) navigator.sendBeacon?.(`/api/rooms/${code}/leave?as=${portal}`);
    active = false;
    if (channel) { sb.removeChannel(channel); channel = null; }
  }
  function left(message, canRejoin) {
    active = false;
    Object.values(peers).forEach((e) => e.pc.close()); Object.keys(peers).forEach((k) => delete peers[k]);
    Object.keys(tiles).forEach((k) => { tiles[k].remove(); delete tiles[k]; });
    if (channel) { sb.removeChannel(channel); channel = null; }
    stopLocal(); sharing = false; hand = false; panelOpen = false; showPanel();
    gate(`<h1>${esc(message)}</h1><p class="muted" style="margin:8px 0 18px">${esc(info.title)}</p>${canRejoin ? '<button class="btn primary" id="again">Rejoin</button>' : ""}`);
    $("again") && ($("again").onclick = () => { camOn = micOn = true; start(); });
  }
  window.addEventListener("pagehide", leave);
  start();
})();

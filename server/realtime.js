// Server-side Supabase client, used only to broadcast host-authorized events (force-mic,
// remove, end, lobby-changed) to a room's Realtime channel from Express routes. The actual
// WebRTC signaling, presence (mic/cam/hand/sharing/roster) and reactions are sent directly
// browser-to-Supabase and never pass through here — see teamo/frontend/js/meet.js.
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  realtime: { params: { eventsPerSecond: 20 } },
});

// httpSend() posts the broadcast over plain REST, with no websocket connection needed —
// the right fit for a Netlify Function, which never stays alive long enough to justify
// opening one.
async function send(channelName, event, payload = {}) {
  await supabase.channel(channelName).httpSend(event, payload);
}

function broadcast(roomCode, event, payload) {
  return send(`room:${roomCode}`, event, payload);
}

// Fired after every write (see server/db.js's execute()) so open dashboards know to
// re-fetch — the direct replacement for main.py's in-memory DATA_VERSION counter, which
// can't exist server-side the same way here (Netlify Functions don't share process memory
// across invocations).
function pulse() {
  return send("pulse", "changed");
}

module.exports = { broadcast, pulse };

// Server-side Supabase client, used only to broadcast host-authorized events (force-mic,
// remove, end, lobby-changed) to a room's Realtime channel from Express routes. The actual
// WebRTC signaling, presence (mic/cam/hand/sharing/roster) and reactions are sent directly
// browser-to-Supabase and never pass through here — see teamo/frontend/js/meet.js.
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  realtime: { params: { eventsPerSecond: 20 } },
});

async function broadcast(roomCode, event, payload) {
  const channel = supabase.channel(`room:${roomCode}`);
  await channel.send({ type: "broadcast", event, payload });
  await supabase.removeChannel(channel);
}

module.exports = { broadcast };

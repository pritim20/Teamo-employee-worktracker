// Fast local dev entrypoint (plain Express, no Netlify CLI overhead) — same
// server/app.js code netlify dev and production both run. Use `netlify dev` for
// the final per-phase check (redirects, static files), this for quick iteration.
require("dotenv").config();
const app = require("./app");
const port = process.env.PORT || 8970;
app.listen(port, () => console.log(`listening on ${port}`));

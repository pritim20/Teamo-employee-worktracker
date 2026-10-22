// Netlify Function: wraps server/app.js (Express) with serverless-http so every
// /api/* request (see netlify.toml) is handled by the same Express app whether
// it's running here, under `netlify dev`, or in a plain `node` process.
const serverless = require("serverless-http");
const app = require("../../server/app");

exports.handler = serverless(app);

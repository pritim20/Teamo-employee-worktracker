// Auth: JWT-in-cookie session (replaces Flask's signed-cookie session) and
// werkzeug-compatible scrypt password hashing (so existing Postgres rows created
// by the old Python app keep working — see teamo/main.py's `password` column).
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { rows } = require("./db");
const { ALL_PERMS, LOCKED } = require("./constants");

const SECRET = process.env.SECRET_KEY;
if (!SECRET) throw new Error("SECRET_KEY env var is required");

const COOKIE_NAME = "teamo_session";
const SALT_CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function genSalt(length = 16) {
  let s = "";
  for (let i = 0; i < length; i++) s += SALT_CHARS[crypto.randomInt(SALT_CHARS.length)];
  return s;
}

function scryptHex(password, salt, n, r, p, dklen) {
  const maxmem = 132 * n * r * p; // matches werkzeug's _hash_internal
  return crypto.scryptSync(Buffer.from(password, "utf8"), Buffer.from(salt, "utf8"), dklen, { N: n, r, p, maxmem }).toString("hex");
}

function generatePasswordHash(password) {
  const n = 32768, r = 8, p = 1, salt = genSalt(16);
  const hash = scryptHex(password, salt, n, r, p, 64);
  return `scrypt:${n}:${r}:${p}$${salt}$${hash}`;
}

function checkPasswordHash(pwhash, password) {
  if (!pwhash || typeof pwhash !== "string") return false;
  const parts = pwhash.split("$");
  if (parts.length !== 3) return false;
  const [method, salt, hashHex] = parts;
  const [name, nStr, rStr, pStr] = method.split(":");
  if (name !== "scrypt") return false; // only method main.py ever used
  const n = parseInt(nStr, 10), r = parseInt(rStr, 10), p = parseInt(pStr, 10);
  const dklen = hashHex.length / 2;
  const actual = scryptHex(password, salt, n, r, p, dklen);
  const a = Buffer.from(actual, "hex"), b = Buffer.from(hashHex, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// session cookie: one JWT holds both { uid_admin, uid_employee } so an admin
// and an employee can be logged in side by side in the same browser, exactly
// like Flask's session dict did.
function readSession(req) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return {};
  try {
    const { uid_admin, uid_employee } = jwt.verify(token, SECRET);
    return { uid_admin, uid_employee };
  } catch {
    return {};
  }
}

function writeSession(res, session) {
  const token = jwt.sign(session, SECRET, { expiresIn: "12h" });
  res.cookie(COOKIE_NAME, token, { httpOnly: true, sameSite: "lax", maxAge: 12 * 60 * 60 * 1000 });
}

function requestPortal(req) {
  let p = req.get("X-Portal") || req.query.as;
  if (p !== "admin" && p !== "employee") {
    const ref = req.get("Referer") || "";
    let refPath = "";
    try { refPath = new URL(ref).pathname; } catch { /* no referer */ }
    const path = refPath.startsWith("/admin") || refPath.startsWith("/employee") ? refPath : req.path;
    p = path.startsWith("/employee") ? "employee" : "admin";
  }
  return p;
}

// Runs on every request: resolves req.portal/req.session (raw cookie payload) up
// front. req.user is attached lazily by requireLogin/requireStaff/requireEmployee
// (an async DB lookup, so it can't run synchronously for every single request —
// routes that don't need auth shouldn't pay for it).
function attachSession(req, res, next) {
  req.portal = requestPortal(req);
  req.sessionData = readSession(req);
  next();
}

async function loadUser(req) {
  const uid = req.sessionData[`uid_${req.portal}`];
  if (!uid) return null;
  const found = await rows("SELECT * FROM users WHERE id=? AND active=1", [uid]);
  return found[0] || null;
}

function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}

async function userPerms(u) {
  if (!u || !["admin", "manager", "employee"].includes(u.role)) return [];
  const granted = (await rows("SELECT perm FROM permissions WHERE role=? AND allowed=1", [u.role])).map((r) => r.perm);
  if (u.role === "admin") {
    for (const [role, perm] of LOCKED) if (role === "admin" && !granted.includes(perm)) granted.push(perm);
  }
  return granted;
}

function requireLogin() {
  return async (req, res, next) => {
    req.user = await loadUser(req);
    if (!req.user) return res.status(401).json({ error: "Not logged in" });
    next();
  };
}

function requireStaff(perm = null) {
  return async (req, res, next) => {
    req.user = await loadUser(req);
    if (!req.user) return res.status(401).json({ error: "Not logged in" });
    if (!["admin", "manager"].includes(req.user.role)) return res.status(403).json({ error: "Admin access required" });
    if (perm) {
      const perms = await userPerms(req.user);
      if (!perms.includes(perm)) return res.status(403).json({ error: "You don't have permission for this action" });
    }
    next();
  };
}

function requireEmployee() {
  return async (req, res, next) => {
    req.user = await loadUser(req);
    if (!req.user) return res.status(401).json({ error: "Not logged in" });
    if (req.user.role !== "employee") return res.status(403).json({ error: "Employee access only" });
    next();
  };
}

// Employee-side permission gate (mirrors Python's needs_perm): call after
// requireEmployee, inside a handler, when the action needs a specific perm.
async function needsPerm(req, perm, what) {
  const perms = await userPerms(req.user);
  if (!perms.includes(perm)) return { error: `Your admin has turned off permission to ${what}.` };
  return null;
}

module.exports = {
  generatePasswordHash, checkPasswordHash,
  readSession, writeSession, requestPortal, attachSession, loadUser,
  publicUser, userPerms, requireLogin, requireStaff, requireEmployee, needsPerm,
  COOKIE_NAME, ALL_PERMS,
};

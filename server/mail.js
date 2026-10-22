// SMTP email, ported from teamo/main.py's mail_config/smtp_send/send_mail/send_template
// and teamo/mail_templates.py. Settings live in the "settings" table (mail_* keys),
// configured from the admin Settings page — same source of truth as the Python version.
const fs = require("fs");
const path = require("path");
const nodemailer = require("nodemailer");

const { execute } = require("./db");
const { setting, nowTs } = require("./util");
const { MAIL_KEYS } = require("./constants");

const TEMPLATE_DIR = path.join(__dirname, "..", "teamo", "mail_templates");

async function mailConfig() {
  const cfg = {};
  for (const k of MAIL_KEYS) cfg[k] = await setting(k, "");
  return cfg;
}

async function logMail(to, subject, status, error = "") {
  await execute("INSERT INTO mail_log(to_addr,subject,status,error,ts) VALUES(?,?,?,?,?)", [to, subject, status, error.slice(0, 300), nowTs()]);
  await execute("DELETE FROM mail_log WHERE id NOT IN (SELECT id FROM mail_log ORDER BY id DESC LIMIT 100)");
}

async function smtpSend(cfg, to, subject, text, html) {
  try {
    const sender = cfg.mail_from || cfg.mail_user;
    const port = parseInt(cfg.mail_port || "587", 10);
    const transport = nodemailer.createTransport({
      host: cfg.mail_host,
      port,
      secure: port === 465, // SSL from the start on 465; otherwise STARTTLS when the server offers it (nodemailer does this automatically)
      auth: cfg.mail_user ? { user: cfg.mail_user, pass: cfg.mail_password } : undefined,
      connectionTimeout: 15000,
    });
    await transport.sendMail({
      to, subject,
      from: cfg.mail_from_name ? `"${cfg.mail_from_name}" <${sender}>` : sender,
      text,
      html: html || undefined,
    });
    return "";
  } catch (e) {
    return `${e.name || "Error"}: ${e.message}`;
  }
}

// Queues an email (fire-and-forget) or, with wait=true, sends it inline and returns
// the error text. Unlike main.py's background thread (which can't survive past a
// Netlify Function's response), "queued" here just means "not awaited by the caller" —
// it still runs out to completion before the function instance is frozen since Node's
// event loop keeps it alive, but callers that need to report success/failure (e.g.
// registration approval, which shows the admin whether the email went out) pass wait=true.
async function sendMail(to, subject, text, html = null, wait = false) {
  const cfg = await mailConfig();
  const problem =
    cfg.mail_enabled !== "1" ? "Email is switched off in Settings" :
    !cfg.mail_host ? "No SMTP server is set in Settings" :
    !(cfg.mail_from || cfg.mail_user) ? "No sender address is set in Settings" :
    (cfg.mail_user && !cfg.mail_password) ? "No password is saved for the mail account" : "";
  if (problem) {
    await logMail(to, subject, "skipped", problem);
    return problem;
  }
  const work = async () => {
    const err = await smtpSend(cfg, to, subject, text, html);
    await logMail(to, subject, err ? "failed" : "sent", err);
    return err;
  };
  if (wait) return work();
  work().catch(() => {}); // logged inside work(); never let a background send reject uncaught
  return "";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function mailHtml(title, lines, button = null) {
  const co = escapeHtml(await setting("company_name", "Teamo"));
  const body = lines.map((l) => `<p style="margin:0 0 14px;line-height:1.55">${l}</p>`).join("");
  const btn = button
    ? `<p style="margin:22px 0 4px"><a href="${escapeHtml(button[1])}" style="background:#6366f1;color:#fff;text-decoration:none;` +
      `padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${escapeHtml(button[0])}</a></p>`
    : "";
  return `<div style="background:#f3f4fb;padding:28px 12px;font-family:Segoe UI,Arial,sans-serif;color:#1f2145"><div style="max-width:520px;margin:0 auto;` +
    `background:#fff;border-radius:16px;padding:30px;border:1px solid #e3e5f5"><div style="font-weight:800;font-size:20px;color:#6366f1;margin-bottom:18px">${co}</div>` +
    `<h2 style="margin:0 0 14px;font-size:20px">${escapeHtml(title)}</h2>${body}${btn}` +
    `<p style="margin:26px 0 0;font-size:12px;color:#8a8db3">This is an automated message from ${co}.</p></div></div>`;
}

// {placeholder} replacement, leaving CSS braces and unknown placeholders untouched.
function fill(text, values, escapeValues) {
  return text.replace(/\{([a-z_]+)\}/g, (m, key) => {
    if (!(key in values)) return m;
    const v = String(values[key]);
    return escapeValues ? escapeHtml(v) : v;
  });
}

function renderTemplate(template, values) {
  const txt = fs.readFileSync(path.join(TEMPLATE_DIR, template + ".txt"), "utf-8");
  const nl = txt.indexOf("\n");
  const first = nl === -1 ? txt : txt.slice(0, nl);
  const rest = nl === -1 ? "" : txt.slice(nl + 1);
  if (!first.toLowerCase().startsWith("subject:")) throw new Error(`${template}.txt must start with a 'Subject:' line`);
  const subject = fill(first.slice(8).trim(), values, false);
  const text = fill(rest.replace(/^\n+/, ""), values, false).trim() + "\n";
  let html = null;
  const htmlPath = path.join(TEMPLATE_DIR, template + ".html");
  if (fs.existsSync(htmlPath)) html = fill(fs.readFileSync(htmlPath, "utf-8"), values, true);
  return { subject, text, html };
}

async function sendTemplate(to, template, values, wait = false) {
  const vals = { company: await setting("company_name", "Teamo"), ...values };
  let subject, text, html;
  try {
    ({ subject, text, html } = renderTemplate(template, vals));
  } catch (e) {
    await logMail(to, template, "failed", `Template problem: ${e.message}`);
    return `Template problem: ${e.message}`;
  }
  return sendMail(to, subject, text, html, wait);
}

const employeeId = (uid) => `TM-${String(uid).padStart(4, "0")}`;

function mailRegistrationReceived(u) {
  sendTemplate(u.email, "registered", { name: u.name }).catch(() => {});
}

async function mailCredentials(u, loginEmail, password, baseUrl) {
  return sendTemplate(u.personal_email, "approved", {
    name: u.name, employee_id: employeeId(u.id), login_email: loginEmail, password, login_url: baseUrl,
  }, true);
}

function mailRejected(u, reason) {
  sendTemplate(u.personal_email, "rejected", { name: u.name, reason, reason_line: reason ? `Reason: ${reason}` : "" }).catch(() => {});
}

module.exports = { mailConfig, sendMail, mailHtml, mailRegistrationReceived, mailCredentials, mailRejected };

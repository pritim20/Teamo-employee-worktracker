"""
Teamo - Employee Work Tracking System
=====================================
Run frontend + backend with one command:

    pip install flask
    python main.py

Then open http://127.0.0.1:8000

Demo logins
  Admin    : admin@teamo.com    / admin123
  Employee : priya@teamo.com    / emp123
"""
import csv
import mail_templates
import json
import io
import os
import random
import re
import secrets
import smtplib
import ssl
from email.message import EmailMessage
from html import escape as h
import socket
import subprocess
import threading
import time
import uuid
import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from datetime import date, datetime, timedelta
from functools import wraps
from urllib.parse import urlparse

from flask import (Flask, Response, g, jsonify, redirect, request,
                   send_file, session)
from werkzeug.security import check_password_hash, generate_password_hash
from werkzeug.utils import secure_filename

load_dotenv()
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATABASE_URL = os.environ["DATABASE_URL"]  # Supabase Postgres connection string
UPLOAD_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
MAX_FILE_MB, MAX_FILES = 10, 5

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = (MAX_FILE_MB * MAX_FILES + 5) * 1024 * 1024


app.secret_key = os.environ["SECRET_KEY"]  # fixed across all function instances, unlike the old per-machine file
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE="Lax",
                  PERMANENT_SESSION_LIFETIME=timedelta(hours=12))

ALL_PERMS = {
    "employees.view": "View employees",
    "employees.manage": "Add / edit / delete employees",
    "tasks.manage": "Create & assign tasks",
    "attendance.manage": "View & mark attendance",
    "meetings.manage": "Schedule meetings",
    "reports.view": "View reports & analytics",
    "settings.manage": "Change system settings",
    "permissions.manage": "Manage role permissions",
    "audit.view": "View audit log",
}
MANAGER_DEFAULT = {p: (p not in ("settings.manage", "permissions.manage")) for p in ALL_PERMS}
# what employees can do in their own panel (configurable per role in the Permissions page)
EMPLOYEE_PERMS = {
    "attendance.self": "Check in, take breaks and check out",
    "tasks.work": "Start, update and submit assigned tasks",
    "meetings.join": "Request to join meetings",
}
LOCKED = {("admin", "permissions.manage")}  # can't be switched off, so admins can never lock themselves out
STATUSES = ["Available", "Busy", "In Meeting", "On Break", "Away", "Offline"]
COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#3b82f6"]

# ----------------------------------------------------------------- database
# Postgres (Supabase). The table definitions live in supabase/schema.sql, run once
# in the Supabase SQL editor — there's no local schema/migration step here anymore.

# Tables whose primary key isn't a single auto-incrementing "id" column, so execute()
# shouldn't try to append "RETURNING id" to inserts against them.
NO_ID_TABLES = {"permissions", "settings", "meeting_participants", "meeting_join_requests"}


def pg_connect():
    conn = psycopg2.connect(DATABASE_URL, cursor_factory=psycopg2.extras.RealDictCursor)
    conn.autocommit = False
    return conn


def db():
    if "db" not in g:
        g.db = pg_connect()
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def rows(sql, args=()):
    cur = db().cursor()
    cur.execute(sql.replace("?", "%s"), args)
    return [dict(r) for r in cur.fetchall()]


def row(sql, args=()):
    cur = db().cursor()
    cur.execute(sql.replace("?", "%s"), args)
    r = cur.fetchone()
    return dict(r) if r else None


DATA_VERSION = [0]  # bumped on every write so open dashboards know when to refresh


INSERT_TABLE_RE = re.compile(r"^\s*INSERT\s+INTO\s+(\w+)", re.IGNORECASE)


def execute(sql, args=()):
    sql = sql.replace("?", "%s")
    m = INSERT_TABLE_RE.match(sql)
    wants_id = bool(m) and m.group(1) not in NO_ID_TABLES and "RETURNING" not in sql.upper()
    if wants_id:
        sql += " RETURNING id"
    cur = db().cursor()
    cur.execute(sql, args)
    new_id = cur.fetchone()["id"] if wants_id else None
    db().commit()
    DATA_VERSION[0] += 1
    return new_id


def today():
    return date.today().isoformat()


def now_time():
    return datetime.now().strftime("%H:%M")


def now_ts():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def init_db():
    """Idempotent: safe to call on every startup. The schema itself lives in supabase/schema.sql
    (run once by hand in the Supabase SQL editor) — this only seeds permissions and, on a
    brand new database, the demo accounts."""
    with app.app_context():
        for p in ALL_PERMS:
            execute("INSERT INTO permissions VALUES('manager',?,?) ON CONFLICT (role,perm) DO NOTHING", (p, int(MANAGER_DEFAULT[p])))
            execute("INSERT INTO permissions VALUES('admin',?,1) ON CONFLICT (role,perm) DO NOTHING", (p,))
        for p in EMPLOYEE_PERMS:
            execute("INSERT INTO permissions VALUES('employee',?,1) ON CONFLICT (role,perm) DO NOTHING", (p,))
        if row("SELECT COUNT(*) c FROM users")["c"] == 0:
            seed()


def seed():
    print("  Creating demo accounts ...")
    t0 = date.today()
    defaults = {"company_name": "Teamo Technologies", "work_start": "09:30", "work_end": "18:30",
                "late_grace_minutes": "10", "timezone": "Asia/Kolkata", "week_start": "Monday"}
    for k, v in defaults.items():
        execute("INSERT INTO settings VALUES(?,?)", (k, v))
    # permissions are already seeded above in init_db(), before users count is checked

    people = [
        ("Aarav Admin", "admin@teamo.com", "admin123", "admin", "Management", "Administrator"),
        ("Priya Sharma", "priya@teamo.com", "emp123", "employee", "Engineering", "Frontend Developer"),
    ]
    for i, (n, e, pw, r, d, des) in enumerate(people):
        execute("INSERT INTO users(name,email,password,role,department,designation,phone,joined,status,color)"
                " VALUES(?,?,?,?,?,?,?,?,?,?)",
                (n, e, generate_password_hash(pw), r, d, des, "", t0.isoformat(), "Offline" if r == "employee" else "Available",
                 COLORS[i % len(COLORS)]))
    execute("INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(1,'System','SEED','Demo accounts created','-',?)",
            (now_ts(),))


# ----------------------------------------------------------------- email (SMTP configured from the Settings page)

MAIL_KEYS = ("mail_enabled", "mail_host", "mail_port", "mail_user", "mail_password", "mail_from", "mail_from_name")


def mail_config():
    return {k: setting(k, "") for k in MAIL_KEYS}


def log_mail(to, subject, status, error=""):
    """Own connection: this also runs from the background sender thread, outside any request."""
    conn = pg_connect()
    cur = conn.cursor()
    cur.execute("INSERT INTO mail_log(to_addr,subject,status,error,ts) VALUES(%s,%s,%s,%s,%s)", (to, subject, status, error[:300], now_ts()))
    cur.execute("DELETE FROM mail_log WHERE id NOT IN (SELECT id FROM mail_log ORDER BY id DESC LIMIT 100)")
    conn.commit()
    conn.close()


def smtp_send(cfg, to, subject, text, html):
    """Sends one message; returns an error string, or '' on success."""
    try:
        msg = EmailMessage()
        sender = cfg["mail_from"] or cfg["mail_user"]
        msg["Subject"], msg["To"] = subject, to
        msg["From"] = f"{cfg['mail_from_name']} <{sender}>" if cfg["mail_from_name"] else sender
        msg.set_content(text)
        if html:
            msg.add_alternative(html, subtype="html")
        port = int(cfg["mail_port"] or 587)
        # encryption follows the port: 465 is SSL from the start; anything else upgrades with STARTTLS when the server offers it
        if port == 465:
            srv = smtplib.SMTP_SSL(cfg["mail_host"], port, timeout=15, context=ssl.create_default_context())
        else:
            srv = smtplib.SMTP(cfg["mail_host"], port, timeout=15)
        with srv:
            srv.ehlo()
            if port != 465 and srv.has_extn("starttls"):
                srv.starttls(context=ssl.create_default_context())
                srv.ehlo()
            if cfg["mail_user"]:
                srv.login(cfg["mail_user"], cfg["mail_password"])
            srv.send_message(msg)
        return ""
    except Exception as e:  # noqa: BLE001 - any failure is reported back, never raised into a request
        return f"{type(e).__name__}: {e}"


def send_mail(to, subject, text, html=None, wait=False):
    """Queue an email (or send it now with wait=True and get the error text back). No-op while email is switched off."""
    cfg = mail_config()
    problem = ("Email is switched off in Settings" if cfg["mail_enabled"] != "1" else
               "No SMTP server is set in Settings" if not cfg["mail_host"] else
               "No sender address is set in Settings" if not (cfg["mail_from"] or cfg["mail_user"]) else
               "No password is saved for the mail account" if cfg["mail_user"] and not cfg["mail_password"] else "")
    if problem:
        log_mail(to, subject, "skipped", problem)  # visible under Settings > Email notifications > Recent emails
        return problem

    def work():
        err = smtp_send(cfg, to, subject, text, html)
        log_mail(to, subject, "failed" if err else "sent", err)
        return err
    if wait:
        return work()
    threading.Thread(target=work, daemon=True).start()
    return ""


def mail_html(title, lines, button=None):
    co = h(setting("company_name", "Teamo"))
    body = "".join(f'<p style="margin:0 0 14px;line-height:1.55">{l}</p>' for l in lines)
    btn = (f'<p style="margin:22px 0 4px"><a href="{h(button[1])}" style="background:#6366f1;color:#fff;text-decoration:none;'
           f'padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">{h(button[0])}</a></p>') if button else ""
    return (f'<div style="background:#f3f4fb;padding:28px 12px;font-family:Segoe UI,Arial,sans-serif;color:#1f2145"><div style="max-width:520px;margin:0 auto;'
            f'background:#fff;border-radius:16px;padding:30px;border:1px solid #e3e5f5"><div style="font-weight:800;font-size:20px;color:#6366f1;margin-bottom:18px">{co}</div>'
            f'<h2 style="margin:0 0 14px;font-size:20px">{h(title)}</h2>{body}{btn}'
            f'<p style="margin:26px 0 0;font-size:12px;color:#8a8db3">This is an automated message from {co}.</p></div></div>')


def send_template(to, template, /, wait=False, **values):
    """Renders mail_templates/<template>.txt|.html with the placeholders and sends it. Returns '' or an error."""
    values.setdefault("company", setting("company_name", "Teamo"))
    try:
        subject, text, html = mail_templates.render(template, **values)
    except (OSError, ValueError) as e:
        log_mail(to, template, "failed", f"Template problem: {e}")
        return f"Template problem: {e}"
    return send_mail(to, subject, text, html, wait=wait)


def employee_id(uid):
    return f"TM-{int(uid):04d}"


def mail_registration_received(u):
    send_template(u["email"], "registered", name=u["name"])


def mail_credentials(u, login_email, password, base_url):
    """Sent to the personal address when a manager approves. Returns '' or an error message."""
    return send_template(u["personal_email"], "approved", wait=True, name=u["name"], employee_id=employee_id(u["id"]),
                         login_email=login_email, password=password, login_url=base_url)


def mail_rejected(u, reason):
    send_template(u["personal_email"], "rejected", name=u["name"], reason=reason, reason_line=f"Reason: {reason}" if reason else "")


# ----------------------------------------------------------------- auth helpers

def request_portal():
    """Which panel a request belongs to, so admin and employee can be signed in side by side."""
    p = request.headers.get("X-Portal") or request.args.get("as")
    if p not in ("admin", "employee"):
        ref = urlparse(request.headers.get("Referer", "")).path
        path = ref if ref.startswith(("/admin", "/employee")) else request.path
        p = "employee" if path.startswith("/employee") else "admin"
    return p


def current_user():
    uid = session.get("uid_" + request_portal())
    if not uid:
        return None
    if "user" not in g:
        g.user = row("SELECT * FROM users WHERE id=? AND active=1", (uid,))
    return g.user


def audit(action, details=""):
    u = current_user()
    execute("INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(?,?,?,?,?,?)",
            (u["id"] if u else None, u["name"] if u else "Anonymous", action, details,
             request.headers.get("X-Forwarded-For", request.remote_addr), now_ts()))


def user_perms(u):
    if not u or u["role"] not in ("admin", "manager", "employee"):
        return []
    granted = [r["perm"] for r in rows("SELECT perm FROM permissions WHERE role=? AND allowed=1", (u["role"],))]
    if u["role"] == "admin":
        granted += [p for r, p in LOCKED if r == "admin" and p not in granted]
    return granted


def needs_perm(perm, what):
    """Employee-side permission gate: returns an error response when the employee's role has it switched off."""
    if perm not in user_perms(current_user()):
        return jsonify(error=f"Your admin has turned off permission to {what}."), 403
    return None


def login_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        if not current_user():
            return jsonify(error="Not logged in"), 401
        return f(*a, **kw)
    return wrapper


def staff_required(perm=None):
    def deco(f):
        @wraps(f)
        def wrapper(*a, **kw):
            u = current_user()
            if not u:
                return jsonify(error="Not logged in"), 401
            if u["role"] not in ("admin", "manager"):
                return jsonify(error="Admin access required"), 403
            if perm and perm not in user_perms(u):
                return jsonify(error="You don't have permission for this action"), 403
            return f(*a, **kw)
        return wrapper
    return deco


def employee_required(f):
    @wraps(f)
    def wrapper(*a, **kw):
        u = current_user()
        if not u:
            return jsonify(error="Not logged in"), 401
        if u["role"] != "employee":
            return jsonify(error="Employee access only"), 403
        return f(*a, **kw)
    return wrapper


def public_user(u):
    if not u:
        return None
    return {k: v for k, v in u.items() if k != "password"}


def body():
    return request.get_json(silent=True) or {}


def setting(key, default=""):
    r = row("SELECT value FROM settings WHERE key=?", (key,))
    return r["value"] if r else default


def in_meeting_ids():
    d, t = today(), now_time()
    ids = {r["user_id"] for r in rows(
        "SELECT mp.user_id FROM meetings m JOIN meeting_participants mp ON mp.meeting_id=m.id "
        "WHERE m.date=? AND m.start_time<=? AND m.end_time>? AND m.ended_early=0", (d, t, t))}
    ids |= {r["id"] for r in rows("SELECT id FROM users WHERE status='In Meeting' AND active=1 AND role='employee'")}
    return ids


# ----------------------------------------------------------------- auth API
# Frontend pages (login.html, admin.html, employee.html, meet.html, /static/*) are served
# directly by Netlify as static files — see netlify.toml — not by Flask anymore. The
# server-side "wrong portal -> redirect to /" guard that used to live in page_admin()/
# page_employee() is now purely client-side: T.api() already sends a logged-out user back
# to "/" on a 401 from any API call (frontend/js/common.js), and the dashboards only ever
# render after a successful authenticated fetch.

@app.post("/api/login")
def api_login():
    b = body()
    email = (b.get("email") or "").strip().lower()
    portal = b.get("portal", "employee")
    u = row("SELECT * FROM users WHERE lower(email)=?", (email,))
    if not u or not check_password_hash(u["password"], b.get("password") or ""):
        execute("INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(NULL,?,?,?,?,?)",
                (email or "unknown", "LOGIN_FAILED", f"Failed login on {portal} portal", request.remote_addr, now_ts()))
        return jsonify(error="Invalid email or password"), 401
    if u["approval"] == "pending":
        return jsonify(error="Your registration is still waiting for a manager's approval. We'll email you once it's reviewed."), 403
    if u["approval"] == "rejected":
        return jsonify(error="Your registration wasn't approved. Contact your manager if you think this is a mistake."), 403
    if not u["active"]:
        return jsonify(error="Your account is deactivated. Contact your admin."), 403
    if portal == "admin" and u["role"] == "employee":
        return jsonify(error="This account is an employee account. Use the Employee login."), 403
    if portal == "employee" and u["role"] != "employee":
        return jsonify(error="This is an admin/manager account. Use the Admin login."), 403
    session.permanent = True
    session["uid_" + ("employee" if u["role"] == "employee" else "admin")] = u["id"]
    g.user = u
    if u["role"] != "employee" or u["status"] == "Offline":
        execute("UPDATE users SET status='Available' WHERE id=?", (u["id"],))
    audit("LOGIN", f"Logged in to {portal} portal")
    return jsonify(ok=True, redirect="/employee" if u["role"] == "employee" else "/admin")


@app.post("/api/logout")
def api_logout():
    u = current_user()
    if u:
        audit("LOGOUT", "Logged out")
        execute("UPDATE users SET status='Offline' WHERE id=?", (u["id"],))
    session.pop("uid_" + request_portal(), None)
    return jsonify(ok=True)


@app.get("/api/pulse")
def api_pulse():
    if not current_user():
        return jsonify(error="Not logged in"), 401
    return jsonify(v=DATA_VERSION[0])


@app.get("/api/me")
@login_required
def api_me():
    u = current_user()
    return jsonify(user=public_user(u), perms=user_perms(u), company=setting("company_name", "Teamo"))


# ----------------------------------------------------------------- admin: dashboard

@app.get("/api/admin/dashboard")
@staff_required()
def admin_dashboard():
    d = today()
    emps = rows("SELECT id,name,designation,department,status,color FROM users WHERE role='employee' AND active=1 ORDER BY name")
    att = {r["user_id"]: r for r in rows("SELECT * FROM attendance WHERE date=?", (d,))}
    meet_ids = in_meeting_ids()
    present = sum(1 for e in emps if att.get(e["id"], {}).get("status") in ("Present", "Late"))
    late = sum(1 for e in emps if att.get(e["id"], {}).get("status") == "Late")
    on_leave = sum(1 for e in emps if att.get(e["id"], {}).get("status") == "Leave")
    pending = row("SELECT COUNT(*) c FROM tasks WHERE status!='Approved'")["c"]
    overdue = row("SELECT COUNT(*) c FROM tasks WHERE status!='Approved' AND due_date<?", (d,))["c"]

    week = []
    for back in range(6, -1, -1):
        dd = (date.today() - timedelta(days=back))
        c = row("SELECT COUNT(*) c FROM attendance WHERE date=? AND status IN ('Present','Late')", (dd.isoformat(),))["c"]
        week.append({"label": dd.strftime("%a"), "date": dd.isoformat(), "value": c})

    task_stats = {s: row("SELECT COUNT(*) c FROM tasks WHERE status=?", (s,))["c"]
                  for s in ("Assigned", "In Progress", "Submitted", "Approved")}
    live = []
    for e in emps:
        a = att.get(e["id"])
        if e["id"] in meet_ids:  # being in a meeting takes priority over attendance state
            st = "In Meeting"
        elif not a or a["status"] in ("Absent", "Leave") or not a.get("check_in"):
            st = a["status"] if a and a["status"] in ("Absent", "Leave") else "Not checked in"
        elif a.get("check_out"):
            st = "Checked out"
        else:
            st = e["status"]
        live.append({**e, "live_status": st, "check_in": a.get("check_in") if a else None})

    meetings_today = rows("SELECT m.*, (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id=m.id) participants "
                          "FROM meetings m WHERE date=? ORDER BY start_time", (d,))
    for m in meetings_today:
        m["state"] = meeting_state(m)
    recent = rows("SELECT * FROM audit_log ORDER BY id DESC LIMIT 6")
    dept = rows("SELECT department label, COUNT(*) value FROM users WHERE role='employee' AND active=1 GROUP BY department ORDER BY value DESC")
    top_tasks = rows("SELECT t.*, u.name assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to "
                     "WHERE t.status!='Approved' ORDER BY CASE t.priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END, due_date LIMIT 6")
    return jsonify(total=len(emps), present=present, absent=len(emps) - present - on_leave, late=late, on_leave=on_leave,
                   in_meeting=len([i for i in meet_ids if i in {e['id'] for e in emps}]),
                   pending_tasks=pending, overdue=overdue, week=week, task_stats=task_stats, live=live,
                   meetings_today=meetings_today, recent=recent, departments=dept, top_tasks=top_tasks)


# ----------------------------------------------------------------- admin: employees

@app.get("/api/employees")
@staff_required("employees.view")
def list_employees():
    role = request.args.get("role")
    sql = "SELECT * FROM users WHERE approval='approved'"
    args = []
    if role:
        sql += " AND role=?"
        args.append(role)
    if current_user()["role"] == "manager":
        sql += " AND role!='admin'"
    users = [public_user(u) for u in rows(sql + " ORDER BY role, name", args)]
    return jsonify(users)


def validate_user_payload(b, creating):
    if creating:
        for f in ("name", "email", "password"):
            if not (b.get(f) or "").strip():
                return f"{f.title()} is required"
    if b.get("email") and "@" not in b["email"]:
        return "Enter a valid email"
    if b.get("role") and b["role"] not in ("admin", "manager", "employee"):
        return "Invalid role"
    return None


@app.post("/api/employees")
@staff_required("employees.manage")
def create_employee():
    b = body()
    err = validate_user_payload(b, True)
    if err:
        return jsonify(error=err), 400
    role = b.get("role", "employee")
    if role == "admin" and current_user()["role"] != "admin":
        return jsonify(error="Only admins can create admin accounts"), 403
    if row("SELECT id FROM users WHERE lower(email)=?", (b["email"].strip().lower(),)):
        return jsonify(error="Email already exists"), 400
    uid = execute("INSERT INTO users(name,email,password,role,department,designation,phone,joined,color,address,gender) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
                  (b["name"].strip(), b["email"].strip().lower(), generate_password_hash(b["password"]), role,
                   b.get("department", ""), b.get("designation", ""), b.get("phone", ""), b.get("joined") or today(),
                   random.choice(COLORS), (b.get("address") or "")[:300], b.get("gender") if b.get("gender") in ("Male", "Female", "Other") else ""))
    audit("EMPLOYEE_CREATE", f"Created {role} {b['name']} ({b['email']})")
    return jsonify(ok=True, id=uid)


@app.put("/api/employees/<int:uid>")
@staff_required("employees.manage")
def update_employee(uid):
    b = body()
    u = row("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return jsonify(error="Not found"), 404
    me = current_user()
    if me["role"] != "admin" and (u["role"] == "admin" or b.get("role") == "admin"):
        return jsonify(error="Only admins can modify admin accounts"), 403
    err = validate_user_payload(b, False)
    if err:
        return jsonify(error=err), 400
    if uid == me["id"] and b.get("role") and b["role"] != u["role"]:
        return jsonify(error="You cannot change your own role"), 400
    fields = {k: b[k] for k in ("name", "email", "role", "department", "designation", "phone", "address", "gender", "joined", "active") if k in b}
    if "email" in fields:
        fields["email"] = fields["email"].strip().lower()
        if row("SELECT id FROM users WHERE lower(email)=? AND id!=?", (fields["email"], uid)):
            return jsonify(error="Email already exists"), 400
    if b.get("password"):
        fields["password"] = generate_password_hash(b["password"])
    if fields:
        execute(f"UPDATE users SET {', '.join(k + '=?' for k in fields)} WHERE id=?", (*fields.values(), uid))
    audit("EMPLOYEE_UPDATE", f"Updated {u['name']}: {', '.join(k for k in fields if k != 'password') or 'password'}")
    return jsonify(ok=True)


@app.delete("/api/employees/<int:uid>")
@staff_required("employees.manage")
def delete_employee(uid):
    u = row("SELECT * FROM users WHERE id=?", (uid,))
    if not u:
        return jsonify(error="Not found"), 404
    if uid == current_user()["id"]:
        return jsonify(error="You cannot delete yourself"), 400
    if u["role"] == "admin" and current_user()["role"] != "admin":
        return jsonify(error="Only admins can delete admin accounts"), 403
    execute("DELETE FROM meeting_participants WHERE user_id=?", (uid,))
    execute("DELETE FROM attendance WHERE user_id=?", (uid,))
    execute("UPDATE tasks SET assigned_to=NULL WHERE assigned_to=?", (uid,))
    execute("DELETE FROM users WHERE id=?", (uid,))
    audit("EMPLOYEE_DELETE", f"Deleted {u['name']} ({u['email']})")
    return jsonify(ok=True)


# ----------------------------------------------------------------- admin: tasks

@app.get("/api/tasks")
@staff_required("tasks.manage")
def list_tasks():
    sql = ("SELECT t.*, u.name assignee, u.color assignee_color, c.name creator, (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=t.id) comment_count FROM tasks t "
           "LEFT JOIN users u ON u.id=t.assigned_to LEFT JOIN users c ON c.id=t.created_by WHERE 1=1")
    args = []
    for key in ("status", "priority"):
        if request.args.get(key):
            sql += f" AND t.{key}=?"
            args.append(request.args[key])
    if request.args.get("assigned_to"):
        sql += " AND t.assigned_to=?"
        args.append(request.args["assigned_to"])
    return jsonify(rows(sql + " ORDER BY t.id DESC", args))


@app.post("/api/tasks")
@staff_required("tasks.manage")
def create_task():
    b = body()
    if not (b.get("title") or "").strip():
        return jsonify(error="Title is required"), 400
    tid = execute("INSERT INTO tasks(title,description,assigned_to,created_by,priority,status,due_date,created_at,project) VALUES(?,?,?,?,?,?,?,?,?)",
                  (b["title"].strip(), b.get("description", ""), b.get("assigned_to") or None, current_user()["id"],
                   b.get("priority", "Medium"), "Assigned", b.get("due_date") or today(), now_ts(),
                   (b.get("project") or "").strip()[:80]))
    log_task(tid, "created", "created the task" + (f" and assigned it to {row('SELECT name FROM users WHERE id=?', (b['assigned_to'],))['name']}" if b.get("assigned_to") and row("SELECT name FROM users WHERE id=?", (b["assigned_to"],)) else ""))
    audit("TASK_CREATE", f"Task #{tid} '{b['title']}'")
    return jsonify(ok=True, id=tid)


@app.delete("/api/tasks/<int:tid>")
@staff_required("tasks.manage")
def delete_task(tid):
    t = row("SELECT * FROM tasks WHERE id=?", (tid,))
    if not t:
        return jsonify(error="Not found"), 404
    for a in rows("SELECT stored FROM task_attachments WHERE task_id=?", (tid,)):
        try:
            os.remove(os.path.join(UPLOAD_DIR, a["stored"]))
        except OSError:
            pass
    execute("DELETE FROM task_attachments WHERE task_id=?", (tid,))
    execute("DELETE FROM task_feedback WHERE task_id=?", (tid,))
    execute("DELETE FROM task_comments WHERE task_id=?", (tid,))
    execute("DELETE FROM task_activity WHERE task_id=?", (tid,))
    execute("DELETE FROM tasks WHERE id=?", (tid,))
    audit("TASK_DELETE", f"Task #{tid} '{t['title']}' deleted")
    return jsonify(ok=True)


# ----------------------------------------------------------------- task submission & review

def log_task(tid, kind, text, detail=""):
    u = current_user()
    execute("INSERT INTO task_activity(task_id,kind,text,detail,actor,role,ts) VALUES(?,?,?,?,?,?,?)",
            (tid, kind, text, detail, u["name"] if u else "System", u["role"] if u else "", now_ts()))


def task_for_user(tid):
    """(task, is_staff) when the current user is the assignee or a staff member who manages tasks."""
    u = current_user()
    t = row("SELECT * FROM tasks WHERE id=?", (tid,))
    if not u or not t:
        return None, False
    if u["role"] in ("admin", "manager") and "tasks.manage" in user_perms(u):
        return t, True
    return (t, False) if t["assigned_to"] == u["id"] else (None, False)


@app.get("/api/tasks/<int:tid>/info")
def task_info(tid):
    t, _ = task_for_user(tid)
    if not t:
        return jsonify(error="Task not found"), 404
    return jsonify(task=t,
                   attachments=rows("SELECT id,filename,url,uploaded_by,ts FROM task_attachments WHERE task_id=? ORDER BY id", (tid,)),
                   feedback=rows("SELECT * FROM task_feedback WHERE task_id=? ORDER BY id DESC", (tid,)))


@app.get("/api/tasks/<int:tid>/activity")
def task_activity_list(tid):
    t, _ = task_for_user(tid)
    if not t:
        return jsonify(error="Task not found"), 404
    return jsonify(task={"id": t["id"], "title": t["title"], "status": t["status"]},
                   events=rows("SELECT * FROM task_activity WHERE task_id=? ORDER BY id DESC", (tid,)))


@app.get("/api/tasks/<int:tid>/comments")
def task_comments_list(tid):
    t, _ = task_for_user(tid)
    if not t:
        return jsonify(error="Task not found"), 404
    return jsonify(task={"id": t["id"], "title": t["title"], "status": t["status"]}, me=current_user()["id"],
                   comments=rows("SELECT * FROM task_comments WHERE task_id=? ORDER BY id", (tid,)))


@app.post("/api/tasks/<int:tid>/comments")
def task_comment_add(tid):
    t, _ = task_for_user(tid)
    if not t:
        return jsonify(error="Task not found"), 404
    text = (body().get("text") or "").strip()
    if not text:
        return jsonify(error="Write a message first"), 400
    if len(text) > 2000:
        return jsonify(error="Message is too long (2000 characters max)"), 400
    u = current_user()
    execute("INSERT INTO task_comments(task_id,user_id,author,role,text,ts) VALUES(?,?,?,?,?,?)",
            (tid, u["id"], u["name"], u["role"], text, now_ts()))
    return jsonify(ok=True)


@app.get("/api/attachments/<int:aid>")
def task_attachment_download(aid):
    a = row("SELECT * FROM task_attachments WHERE id=?", (aid,))
    t, _ = task_for_user(a["task_id"]) if a else (None, False)
    if not t:
        return jsonify(error="File not found"), 404
    path = os.path.join(UPLOAD_DIR, a["stored"])
    if not a["stored"] or not os.path.isfile(path):
        return jsonify(error="File not found"), 404
    return send_file(path, as_attachment=True, download_name=a["filename"])


def clean_links(raw):
    out = []
    for line in (raw or "").replace(",", "\n").splitlines():
        u = line.strip()
        if u and not u.lower().startswith(("http://", "https://")):
            u = "https://" + u
        if u:
            out.append(u[:500])
    return out


@app.post("/api/tasks/<int:tid>/attachments")
def task_attach(tid):
    """Attach files and/or pasted links to a task. Staff can add reference material; the assignee adds their work."""
    u = current_user()
    t, staff = task_for_user(tid)
    if not u or not t:
        return jsonify(error="Task not found"), 404
    if t["status"] == "Approved":
        return jsonify(error="This task is already approved"), 400
    if not staff:
        if (g := needs_perm("tasks.work", "work on tasks")):
            return g
        if t["status"] != "In Progress":
            return jsonify(error="Start the task before attaching work"), 400
    files = [f for f in request.files.getlist("files") if f and f.filename]
    links = clean_links(request.form.get("links"))
    if not files and not links:
        return jsonify(error="Choose a file or paste a link"), 400
    if len(files) > MAX_FILES:
        return jsonify(error=f"Attach up to {MAX_FILES} files at a time"), 400
    for l in links:
        if " " in l or "." not in l.split("//", 1)[1]:
            return jsonify(error=f"'{l}' doesn't look like a valid link"), 400
    saved = []
    for f in files:
        name = secure_filename(f.filename) or "file"
        stored = uuid.uuid4().hex + "_" + name
        path = os.path.join(UPLOAD_DIR, stored)
        f.save(path)
        size = os.path.getsize(path)
        if size > MAX_FILE_MB * 1024 * 1024 or size == 0:
            os.remove(path)
            for _, st in saved:
                os.remove(os.path.join(UPLOAD_DIR, st))
            return jsonify(error=f"{name} is {'larger than ' + str(MAX_FILE_MB) + ' MB' if size else 'empty'}"), 400
        saved.append((name, stored))
    for name, stored in saved:
        execute("INSERT INTO task_attachments(task_id,filename,stored,uploaded_by,ts) VALUES(?,?,?,?,?)", (tid, name, stored, u["name"], now_ts()))
    for l in links:
        execute("INSERT INTO task_attachments(task_id,filename,stored,url,uploaded_by,ts) VALUES(?,?,?,?,?,?)", (tid, l, "", l, u["name"], now_ts()))
    bits = [f"{len(saved)} file{'s' if len(saved) != 1 else ''}"] if saved else []
    bits += [f"{len(links)} link{'s' if len(links) != 1 else ''}"] if links else []
    log_task(tid, "file", "attached " + " and ".join(bits), ", ".join([n for n, _ in saved] + links))
    audit("TASK_ATTACH", f"{' and '.join(bits)} attached to task #{tid}")
    return jsonify(ok=True)


@app.delete("/api/task-attachments/<int:aid>")
def task_attachment_delete(aid):
    a = row("SELECT * FROM task_attachments WHERE id=?", (aid,))
    t, staff = task_for_user(a["task_id"]) if a else (None, False)
    if not t:
        return jsonify(error="Not found"), 404
    if not staff and (a["uploaded_by"] != current_user()["name"] or t["status"] not in ("Assigned", "In Progress")):
        return jsonify(error="You can only remove your own attachments before submitting"), 403
    if a["stored"]:
        try:
            os.remove(os.path.join(UPLOAD_DIR, a["stored"]))
        except OSError:
            pass
    execute("DELETE FROM task_attachments WHERE id=?", (aid,))
    log_task(a["task_id"], "file", "removed an attachment", a["url"] or a["filename"])
    return jsonify(ok=True)


@app.post("/api/tasks/<int:tid>/review")
@staff_required("tasks.manage")
def review_task(tid):
    t = row("SELECT * FROM tasks WHERE id=?", (tid,))
    if not t:
        return jsonify(error="Not found"), 404
    if t["status"] != "Submitted":
        return jsonify(error="Only submitted work can be reviewed"), 400
    b = body()
    decision, comment = b.get("decision"), (b.get("comment") or "").strip()
    me = current_user()["name"]
    if decision == "approve":
        execute("UPDATE tasks SET status='Approved', completed_at=? WHERE id=?", (today(), tid))
        execute("INSERT INTO task_feedback(task_id,kind,text,author,ts) VALUES(?,?,?,?,?)", (tid, "approved", comment, me, now_ts()))
        log_task(tid, "approved", "approved the work", comment)
    elif decision == "changes":
        if not comment:
            return jsonify(error="Tell the employee what needs to change"), 400
        execute("UPDATE tasks SET status='Assigned', completed_at=NULL WHERE id=?", (tid,))
        execute("INSERT INTO task_feedback(task_id,kind,text,author,ts) VALUES(?,?,?,?,?)", (tid, "changes", comment, me, now_ts()))
        log_task(tid, "changes", "requested changes and sent the task back to the employee", comment)
    else:
        return jsonify(error="Invalid decision"), 400
    audit("TASK_REVIEW", f"Task #{tid} '{t['title']}': {decision}")
    return jsonify(ok=True)


# ----------------------------------------------------------------- Teamo meeting rooms (WebRTC, signalled by this server)

ROOMS = {}
ROOM_LOCK = threading.Condition()
PEER_TIMEOUT = 25
ICE_SERVERS = json.loads(os.environ.get("TEAMO_ICE_SERVERS", "[]"))  # optional: your own STUN/TURN servers
REACTIONS = ["👍", "❤️", "😂", "👏", "🎉", "😮", "🙌", "🤔"]  # fixed set: keeps reactions safe to render as-is, no free text


def room_of(code):
    return ROOMS.setdefault(code, {"peers": {}, "queues": {}, "chat": [], "reactions": [], "kicks": {}, "v": 0, "ended": False})


def room_poke(code):
    with ROOM_LOCK:
        room_of(code)["v"] += 1
        ROOM_LOCK.notify_all()


def mark_in_meeting(uid, on):
    """Live status shown on the dashboards. Only employees are tracked this way (admins/managers don't have a monitored live status)."""
    if on:
        execute("UPDATE users SET status='In Meeting' WHERE id=? AND role='employee'", (uid,))
    else:
        execute("UPDATE users SET status='Available' WHERE id=? AND role='employee' AND status='In Meeting'", (uid,))


def drop_peer(r, pid):
    p = r["peers"].pop(pid, None)
    r["queues"].pop(pid, None)
    r["v"] += 1
    if p and not any(x["user_id"] == p["user_id"] for x in r["peers"].values()):
        mark_in_meeting(p["user_id"], False)  # that was their last connection in this room, so they've left


def purge_peers(r):
    now = time.time()
    for pid in [p for p, x in r["peers"].items() if now - x["seen"] > PEER_TIMEOUT]:
        drop_peer(r, pid)
    for pid in [p for p, ts in r["kicks"].items() if now - ts > 60]:
        r["kicks"].pop(pid, None)  # the removed person never polled again to see the notice; stop keeping it


def room_access(code):
    """(meeting, user, is_host, access) -- access is approved | pending | denied | none | closed."""
    u = current_user()
    m = row("SELECT * FROM meetings WHERE room_code=? AND room_code!=''", (code,))
    if not u or not m:
        return None, u, False, None
    if u["role"] in ("admin", "manager") and "meetings.manage" in user_perms(u):
        return m, u, True, "approved"
    if not row("SELECT 1 FROM meeting_participants WHERE meeting_id=? AND user_id=?", (m["id"], u["id"])):
        return None, u, False, None
    if m["date"] != today():
        return m, u, False, "closed"
    r = row("SELECT status FROM meeting_join_requests WHERE meeting_id=? AND user_id=?", (m["id"], u["id"]))
    return m, u, False, (r["status"] if r else "none")


def room_guard(code, need_approved=True):
    m, u, host, access = room_access(code)
    if not u:
        return None, (jsonify(error="Not logged in"), 401)
    if not m:
        return None, (jsonify(error="Meeting room not found"), 404)
    if need_approved and access != "approved":
        return None, (jsonify(error="The host hasn't admitted you yet"), 403)
    return (m, u, host), None


@app.get("/api/rooms/<code>/info")
def room_info(code):
    m, u, host, access = room_access(code)
    if not u:
        return jsonify(error="Not logged in"), 401
    if not m:
        return jsonify(error="Meeting room not found"), 404
    return jsonify(title=m["title"], description=m["description"], date=m["date"], start=m["start_time"], end=m["end_time"],
                   host=host, access=access, state=meeting_state(m), me={"id": u["id"], "name": u["name"], "color": u["color"], "role": u["role"]},
                   ice=ICE_SERVERS)


@app.post("/api/rooms/<code>/request")
def room_request(code):
    m, u, host, access = room_access(code)
    if not u:
        return jsonify(error="Not logged in"), 401
    if not m:
        return jsonify(error="Meeting room not found"), 404
    if access in ("none", "denied"):
        execute("INSERT INTO meeting_join_requests VALUES(?,?,'pending',?) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='pending', ts=EXCLUDED.ts", (m["id"], u["id"], now_ts()))
        audit("MEETING_JOIN_REQUEST", f"Requested to join '{m['title']}'")
        room_poke(code)
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/join")
def room_join(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    with ROOM_LOCK:
        r = room_of(code)
        if r["ended"] and host:
            r.update(ended=False, chat=[], peers={}, queues={})
            execute("UPDATE meetings SET ended_early=0 WHERE id=?", (m["id"],))  # host restarted the call; it's back in progress
        if r["ended"]:
            return jsonify(error="The host ended this meeting"), 410
        purge_peers(r)
        for pid in [p for p, x in r["peers"].items() if x["user_id"] == u["id"]]:
            drop_peer(r, pid)  # a refreshed tab replaces its old connection
        others = [{"peer": p, **{k: x[k] for k in ("user_id", "name", "color", "role", "mic", "cam", "hand", "sharing")}} for p, x in r["peers"].items()]
        pid = secrets.token_hex(6)
        r["peers"][pid] = {"user_id": u["id"], "name": u["name"], "color": u["color"], "role": u["role"], "host": host,
                           "mic": True, "cam": True, "hand": False, "sharing": False, "seen": time.time()}
        r["queues"][pid] = []
        r["v"] += 1
        ROOM_LOCK.notify_all()
        chat_id = r["chat"][-1]["id"] if r["chat"] else 0
        react_id = r["reactions"][-1]["id"] if r["reactions"] else 0
    mark_in_meeting(u["id"], True)  # they're actually in the call now, so show it on the dashboards
    audit("MEETING_ROOM_JOIN", f"Joined room for '{m['title']}'")
    return jsonify(peer=pid, others=others, chat_since=chat_id, history=r["chat"][-50:], react_since=react_id)


@app.get("/api/rooms/<code>/poll")
def room_poll(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    pid, v = request.args.get("peer", ""), request.args.get("v", type=int, default=-1)
    chat_since, react_since = request.args.get("chat", type=int, default=0), request.args.get("react", type=int, default=0)
    deadline = time.time() + 15
    with ROOM_LOCK:
        r = room_of(code)
        while True:
            me = r["peers"].get(pid)
            if not me or me["user_id"] != u["id"]:
                return jsonify(gone=True, kicked=bool(r["kicks"].pop(pid, False)))
            me["seen"] = time.time()
            purge_peers(r)
            if (r["queues"].get(pid) or r["v"] != v or r["ended"] or (r["chat"] and r["chat"][-1]["id"] > chat_since)
                    or (r["reactions"] and r["reactions"][-1]["id"] > react_since)):
                break
            left = deadline - time.time()
            if left <= 0:
                break
            ROOM_LOCK.wait(min(left, 5))
        signals, r["queues"][pid] = r["queues"].get(pid, []), []
        resp = {"v": r["v"], "ended": r["ended"], "signals": signals,
                "peers": [{"peer": p, **{k: x[k] for k in ("user_id", "name", "color", "role", "host", "mic", "cam", "hand", "sharing")}} for p, x in r["peers"].items()],
                "chat": [c for c in r["chat"] if c["id"] > chat_since],
                "reactions": [c for c in r["reactions"] if c["id"] > react_since]}
    if host:
        resp["lobby"] = rows("SELECT r.user_id,u.name,u.color FROM meeting_join_requests r JOIN users u ON u.id=r.user_id "
                             "WHERE r.meeting_id=? AND r.status='pending' ORDER BY r.ts", (m["id"],))
    return jsonify(resp)


@app.post("/api/rooms/<code>/signal")
def room_signal(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    b = body()
    with ROOM_LOCK:
        r = room_of(code)
        me = r["peers"].get(b.get("from"))
        if not me or me["user_id"] != u["id"] or b.get("to") not in r["peers"]:
            return jsonify(error="Peer not found"), 404
        r["queues"].setdefault(b["to"], []).append({"from": b["from"], "type": b.get("type"), "data": b.get("data")})
        ROOM_LOCK.notify_all()
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/state")
def room_state_update(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    b = body()
    with ROOM_LOCK:
        r = room_of(code)
        me = r["peers"].get(b.get("peer"))
        if not me or me["user_id"] != u["id"]:
            return jsonify(error="Peer not found"), 404
        for k in ("mic", "cam", "hand", "sharing"):
            if k in b:
                me[k] = bool(b[k])
        r["v"] += 1
        ROOM_LOCK.notify_all()
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/chat")
def room_chat(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    text = (body().get("text") or "").strip()[:1000]
    if not text:
        return jsonify(error="Write a message first"), 400
    with ROOM_LOCK:
        r = room_of(code)
        r["chat"].append({"id": (r["chat"][-1]["id"] if r["chat"] else 0) + 1, "name": u["name"], "user_id": u["id"], "text": text,
                          "time": datetime.now().strftime("%H:%M")})
        r["chat"] = r["chat"][-200:]
        ROOM_LOCK.notify_all()
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/react")
def room_react(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    emoji = body().get("emoji")
    if emoji not in REACTIONS:
        return jsonify(error="Invalid reaction"), 400
    with ROOM_LOCK:
        r = room_of(code)
        r["reactions"].append({"id": (r["reactions"][-1]["id"] if r["reactions"] else 0) + 1, "user_id": u["id"], "name": u["name"], "emoji": emoji})
        r["reactions"] = r["reactions"][-100:]
        ROOM_LOCK.notify_all()
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/mic/<peer>")
def room_mic(code, peer):
    """Host mutes or unmutes a participant's mic directly."""
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    if not host:
        return jsonify(error="Only the host can do that"), 403
    on = bool(body().get("on"))
    with ROOM_LOCK:
        r = room_of(code)
        target = r["peers"].get(peer)
        if not target:
            return jsonify(error="That person has already left"), 404
        target["mic"] = on
        r["queues"].setdefault(peer, []).append({"from": "__host__", "type": "force-mic", "on": on})
        r["v"] += 1
        ROOM_LOCK.notify_all()
    audit("MEETING_ROOM_MIC", f"{'Unmuted' if on else 'Muted'} {target['name']} in '{m['title']}'")
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/remove/<peer>")
def room_remove(code, peer):
    """Host removes a participant from the call. They're sent back to the request-to-join screen, not an auto-rejoin."""
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    if not host:
        return jsonify(error="Only the host can do that"), 403
    with ROOM_LOCK:
        r = room_of(code)
        target = r["peers"].get(peer)
        if not target:
            return jsonify(error="That person has already left"), 404
        if target["host"]:
            return jsonify(error="You can't remove another host"), 400
        r["kicks"][peer] = time.time()
        drop_peer(r, peer)
        ROOM_LOCK.notify_all()
    execute("UPDATE meeting_join_requests SET status='denied' WHERE meeting_id=? AND user_id=?", (m["id"], target["user_id"]))
    audit("MEETING_ROOM_REMOVE", f"Removed {target['name']} from '{m['title']}'")
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/leave")
def room_leave(code):
    m, u, host, access = room_access(code)
    if not u or not m:
        return jsonify(ok=True)
    pid = request.args.get("peer") or body().get("peer")
    with ROOM_LOCK:
        r = room_of(code)
        if pid in r["peers"] and r["peers"][pid]["user_id"] == u["id"]:
            drop_peer(r, pid)
            ROOM_LOCK.notify_all()
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/end")
def room_end(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    if not host:
        return jsonify(error="Only the host can end the meeting"), 403
    with ROOM_LOCK:
        r = room_of(code)
        for pid in list(r["peers"]):
            drop_peer(r, pid)  # takes everyone's live status back to Available, not just the host's
        r["ended"] = True
        ROOM_LOCK.notify_all()
    execute("UPDATE meetings SET ended_early=1 WHERE id=?", (m["id"],))  # so the dashboard stops showing it as in progress
    audit("MEETING_ROOM_END", f"Ended room for '{m['title']}'")
    return jsonify(ok=True)


@app.post("/api/rooms/<code>/admit")
def room_admit(code):
    ctx, err = room_guard(code)
    if err:
        return err
    m, u, host = ctx
    if not host:
        return jsonify(error="Only the host can admit people"), 403
    b = body()
    status = "approved" if b.get("decision") == "approve" else "denied"
    execute("UPDATE meeting_join_requests SET status=? WHERE meeting_id=? AND user_id=?", (status, m["id"], int(b.get("user_id") or 0)))
    room_poke(code)
    return jsonify(ok=True)


# ----------------------------------------------------------------- admin: attendance

@app.get("/api/attendance")
@staff_required("attendance.manage")
def list_attendance():
    d = request.args.get("date") or today()
    emps = rows("SELECT id,name,department,designation,color FROM users WHERE role='employee' AND active=1 ORDER BY name")
    att = {r["user_id"]: r for r in rows("SELECT * FROM attendance WHERE date=?", (d,))}
    out = []
    for e in emps:
        a = att.get(e["id"])
        out.append({**e, "check_in": a and a["check_in"], "check_out": a and a["check_out"],
                    "status": a["status"] if a else "Not marked", "note": a["note"] if a else ""})
    return jsonify(date=d, records=out)


@app.post("/api/attendance")
@staff_required("attendance.manage")
def mark_attendance():
    b = body()
    uid, d = b.get("user_id"), b.get("date") or today()
    st = b.get("status", "Present")
    if st not in ("Present", "Late", "Absent", "Leave"):
        return jsonify(error="Invalid status"), 400
    ci, co = b.get("check_in") or None, b.get("check_out") or None
    if st in ("Absent", "Leave"):
        ci = co = None
    existing = row("SELECT id FROM attendance WHERE user_id=? AND date=?", (uid, d))
    if existing:
        execute("UPDATE attendance SET status=?, check_in=?, check_out=?, note=? WHERE id=?",
                (st, ci, co, b.get("note", ""), existing["id"]))
    else:
        execute("INSERT INTO attendance(user_id,date,check_in,check_out,status,note) VALUES(?,?,?,?,?,?)",
                (uid, d, ci, co, st, b.get("note", "")))
    u = row("SELECT name FROM users WHERE id=?", (uid,))
    audit("ATTENDANCE_MARK", f"{u['name'] if u else uid} marked {st} on {d}")
    return jsonify(ok=True)


# ----------------------------------------------------------------- admin: meetings

def meeting_state(m):
    t, d = now_time(), today()
    if m["ended_early"] or m["date"] < d or (m["date"] == d and m["end_time"] <= t):
        return "Completed"
    if m["date"] == d and m["start_time"] <= t < m["end_time"]:
        return "In Progress"
    return "Scheduled"


def meeting_with_participants(m):
    m["participants"] = rows("SELECT u.id,u.name,u.color FROM meeting_participants mp JOIN users u ON u.id=mp.user_id "
                             "WHERE mp.meeting_id=?", (m["id"],))
    m["state"] = meeting_state(m)
    return m


@app.get("/api/meetings")
@staff_required("meetings.manage")
def list_meetings():
    ms = rows("SELECT m.*, u.name organiser FROM meetings m LEFT JOIN users u ON u.id=m.created_by ORDER BY date DESC, start_time")
    out = []
    for m in ms:
        m = meeting_with_participants(m)
        m["join_requests"] = rows("SELECT r.user_id,r.status,r.ts,u.name FROM meeting_join_requests r JOIN users u ON u.id=r.user_id "
                                  "WHERE r.meeting_id=? ORDER BY r.ts", (m["id"],))
        out.append(m)
    return jsonify(out)


@app.post("/api/meetings/<int:mid>/join-requests/<int:uid>")
@staff_required("meetings.manage")
def decide_join_request(mid, uid):
    decision = body().get("decision")
    if decision not in ("approve", "deny"):
        return jsonify(error="Invalid decision"), 400
    r = row("SELECT * FROM meeting_join_requests WHERE meeting_id=? AND user_id=?", (mid, uid))
    if not r:
        return jsonify(error="Request not found"), 404
    execute("UPDATE meeting_join_requests SET status=? WHERE meeting_id=? AND user_id=?",
            ("approved" if decision == "approve" else "denied", mid, uid))
    audit("MEETING_JOIN_" + decision.upper(), f"Join request for meeting #{mid} by user #{uid}: {decision}")
    mm = row("SELECT room_code FROM meetings WHERE id=?", (mid,))
    if mm and mm["room_code"]:
        room_poke(mm["room_code"])
    return jsonify(ok=True)


def new_room_code():
    letters = "abcdefghjkmnpqrstuvwxyz"
    while True:
        code = "-".join("".join(secrets.choice(letters) for _ in range(n)) for n in (3, 4, 3))
        if not row("SELECT id FROM meetings WHERE room_code=?", (code,)):
            return code


def save_meeting(b, mid=None):
    for f in ("title", "date", "start_time", "end_time"):
        if not b.get(f):
            return None, f"{f.replace('_', ' ').title()} is required"
    if b["end_time"] <= b["start_time"]:
        return None, "End time must be after start time"
    if not mid:  # only on creation, so correcting other details on a past meeting later still works
        t, d = now_time(), today()
        if b["date"] < d or (b["date"] == d and b["end_time"] <= t):
            return None, "This meeting's date and time have already passed. Check the date and time and try again."
    old = row("SELECT room_code FROM meetings WHERE id=?", (mid,)) if mid else None
    code = ""
    if b.get("teamo_room"):
        code = (old["room_code"] if old and old["room_code"] else new_room_code())
    location = f"/meet/{code}" if code else (b.get("location") or "").strip()
    if mid:
        execute("UPDATE meetings SET title=?,description=?,date=?,start_time=?,end_time=?,location=?,room_code=? WHERE id=?",
                (b["title"], b.get("description", ""), b["date"], b["start_time"], b["end_time"], location, code, mid))
        execute("DELETE FROM meeting_participants WHERE meeting_id=?", (mid,))
    else:
        mid = execute("INSERT INTO meetings(title,description,date,start_time,end_time,location,created_by,room_code) VALUES(?,?,?,?,?,?,?,?)",
                      (b["title"], b.get("description", ""), b["date"], b["start_time"], b["end_time"], location,
                       current_user()["id"], code))
    for uid in set(b.get("participants") or []):
        execute("INSERT INTO meeting_participants VALUES(?,?) ON CONFLICT (meeting_id,user_id) DO NOTHING", (mid, int(uid)))
    return mid, None


@app.post("/api/meetings")
@staff_required("meetings.manage")
def create_meeting():
    mid, err = save_meeting(body())
    if err:
        return jsonify(error=err), 400
    audit("MEETING_CREATE", f"Meeting #{mid} '{body().get('title')}'")
    return jsonify(ok=True, id=mid)


@app.put("/api/meetings/<int:mid>")
@staff_required("meetings.manage")
def update_meeting(mid):
    if not row("SELECT id FROM meetings WHERE id=?", (mid,)):
        return jsonify(error="Not found"), 404
    _, err = save_meeting(body(), mid)
    if err:
        return jsonify(error=err), 400
    audit("MEETING_UPDATE", f"Meeting #{mid} updated")
    return jsonify(ok=True)


@app.delete("/api/meetings/<int:mid>")
@staff_required("meetings.manage")
def delete_meeting(mid):
    m = row("SELECT * FROM meetings WHERE id=?", (mid,))
    if not m:
        return jsonify(error="Not found"), 404
    execute("DELETE FROM meeting_participants WHERE meeting_id=?", (mid,))
    execute("DELETE FROM meeting_join_requests WHERE meeting_id=?", (mid,))
    execute("DELETE FROM meetings WHERE id=?", (mid,))
    audit("MEETING_DELETE", f"Meeting '{m['title']}' deleted")
    return jsonify(ok=True)


# ----------------------------------------------------------------- reports

def hours_between(a, b):
    if not a or not b:
        return 0.0
    h1, m1 = map(int, a.split(":"))
    h2, m2 = map(int, b.split(":"))
    return max(0.0, round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 60, 2))


def employee_report(uid, d_from, d_to):
    att = rows("SELECT * FROM attendance WHERE user_id=? AND date BETWEEN ? AND ?", (uid, d_from, d_to))
    present = sum(1 for a in att if a["status"] in ("Present", "Late"))
    late = sum(1 for a in att if a["status"] == "Late")
    absent = sum(1 for a in att if a["status"] == "Absent")
    leave = sum(1 for a in att if a["status"] == "Leave")
    hours = round(sum(hours_between(a["check_in"], a["check_out"]) for a in att), 1)
    tasks = rows("SELECT status FROM tasks WHERE assigned_to=?", (uid,))
    done = sum(1 for t in tasks if t["status"] == "Approved")
    meetings = row("SELECT COUNT(*) c FROM meeting_participants mp JOIN meetings m ON m.id=mp.meeting_id "
                   "WHERE mp.user_id=? AND m.date BETWEEN ? AND ?", (uid, d_from, d_to))["c"]
    marked = present + absent
    return {"present": present, "late": late, "absent": absent, "leave": leave, "hours": hours,
            "avg_hours": round(hours / present, 1) if present else 0,
            "attendance_rate": round(100 * present / marked) if marked else 0,
            "tasks_total": len(tasks), "tasks_done": done,
            "completion_rate": round(100 * done / len(tasks)) if tasks else 0, "meetings": meetings}


def attendance_history(uid, d_from, d_to):
    where, args = ("a.date BETWEEN ? AND ?", [d_from, d_to])
    if uid:
        where += " AND a.user_id=?"
        args.append(uid)
    recs = rows("SELECT a.date,a.check_in,a.check_out,a.status,u.id user_id,u.name,u.department,u.color FROM attendance a "
                "JOIN users u ON u.id=a.user_id WHERE u.role='employee' AND " + where + " ORDER BY a.date DESC, u.name", args)
    for r in recs:
        r["hours"] = hours_between(r["check_in"], r["check_out"])
    return recs


def completed_tasks(uid, d_from, d_to):
    where, args = ("t.status='Approved' AND t.completed_at BETWEEN ? AND ?", [d_from, d_to])
    if uid:
        where += " AND t.assigned_to=?"
        args.append(uid)
    return rows("SELECT t.id,t.title,t.priority,t.due_date,t.completed_at,t.work_note,u.name assignee FROM tasks t "
                "LEFT JOIN users u ON u.id=t.assigned_to WHERE " + where + " ORDER BY t.completed_at DESC", args)


def report_range():
    d_to = request.args.get("to") or today()
    d_from = request.args.get("from") or (date.fromisoformat(d_to) - timedelta(days=29)).isoformat()
    return d_from, d_to


@app.get("/api/reports")
@staff_required("reports.view")
def reports():
    d_from, d_to = report_range()
    emps = rows("SELECT id,name,department,designation,color FROM users WHERE role='employee' AND active=1 ORDER BY name")
    data = [{**e, **employee_report(e["id"], d_from, d_to)} for e in emps]
    trend = []
    d = date.fromisoformat(d_from)
    end = date.fromisoformat(d_to)
    while d <= end:
        if d.weekday() < 5:
            c = row("SELECT COUNT(*) c FROM attendance WHERE date=? AND status IN ('Present','Late')", (d.isoformat(),))["c"]
            trend.append({"label": d.strftime("%d %b"), "value": c})
        d += timedelta(days=1)
    dept = {}
    for r in data:
        x = dept.setdefault(r["department"] or "Other", {"label": r["department"] or "Other", "hours": 0, "done": 0})
        x["hours"] += r["hours"]
        x["done"] += r["tasks_done"]
    return jsonify(range={"from": d_from, "to": d_to}, employees=data, trend=trend,
                   records=attendance_history(None, d_from, d_to), completed_tasks=completed_tasks(None, d_from, d_to), departments=list(dept.values()),
                   totals={"hours": round(sum(r["hours"] for r in data), 1),
                           "avg_attendance": round(sum(r["attendance_rate"] for r in data) / len(data)) if data else 0,
                           "tasks_done": sum(r["tasks_done"] for r in data),
                           "late": sum(r["late"] for r in data)})


@app.get("/api/reports/export")
@staff_required("reports.view")
def reports_export():
    d_from, d_to = report_range()
    emps = rows("SELECT id,name,department,designation FROM users WHERE role='employee' AND active=1 ORDER BY name")
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Name", "Department", "Designation", "Present", "Late", "Absent", "Leave", "Hours",
                "Avg Hours/Day", "Attendance %", "Tasks", "Tasks Done", "Completion %", "Meetings"])
    for e in emps:
        r = employee_report(e["id"], d_from, d_to)
        w.writerow([e["name"], e["department"], e["designation"], r["present"], r["late"], r["absent"], r["leave"],
                    r["hours"], r["avg_hours"], r["attendance_rate"], r["tasks_total"], r["tasks_done"],
                    r["completion_rate"], r["meetings"]])
    audit("REPORT_EXPORT", f"Exported report {d_from} to {d_to}")
    return Response(buf.getvalue(), mimetype="text/csv",
                    headers={"Content-Disposition": f"attachment; filename=teamo_report_{d_from}_{d_to}.csv"})


# ----------------------------------------------------------------- self-registration & manager approval

REG_ATTEMPTS = {}


@app.post("/api/register")
def api_register():
    ip, now = request.remote_addr, time.time()
    REG_ATTEMPTS[ip] = [t for t in REG_ATTEMPTS.get(ip, []) if now - t < 3600]
    if len(REG_ATTEMPTS[ip]) >= 5:
        return jsonify(error="Too many registrations from this device. Try again later."), 429
    b = body()
    name, email = (b.get("name") or "").strip(), (b.get("email") or "").strip().lower()
    if not name or not email:
        return jsonify(error="Name and email are required"), 400
    if "@" not in email or "." not in email.split("@")[-1] or " " in email:
        return jsonify(error="Enter a valid email address"), 400
    phone, address, gender = (b.get("phone") or "").strip(), (b.get("address") or "").strip(), (b.get("gender") or "").strip()
    digits = "".join(c for c in phone if c.isdigit())
    if not phone or len(digits) < 7 or len(digits) > 15 or any(not (c.isdigit() or c in "+-() ") for c in phone):
        return jsonify(error="Enter a valid phone number"), 400
    if not address:
        return jsonify(error="Address is required"), 400
    if gender not in ("Male", "Female", "Other"):
        return jsonify(error="Select your gender"), 400
    old = row("SELECT * FROM users WHERE lower(personal_email)=? OR lower(email)=?", (email, email))
    if old and old["approval"] != "rejected":
        return jsonify(error="An account for this email already exists" if old["approval"] == "approved" else "A registration for this email is already waiting for approval"), 400
    REG_ATTEMPTS[ip].append(now)
    if old:
        execute("UPDATE users SET name=?,phone=?,address=?,gender=?,approval='pending',active=0,joined=? WHERE id=?",
                (name[:100], phone[:30], address[:300], gender, today(), old["id"]))
    else:
        # no login yet: the manager assigns the company email id and password when approving
        execute("INSERT INTO users(name,email,personal_email,password,role,phone,address,gender,joined,color,active,approval) VALUES(?,?,?,?,'employee',?,?,?,?,?,0,'pending')",
                (name[:100], f"pending-{secrets.token_hex(6)}@registration.invalid", email, generate_password_hash(secrets.token_hex(16)),
                 phone[:30], address[:300], gender, today(), random.choice(COLORS)))
    execute("INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(NULL,?,?,?,?,?)",
            (name, "REGISTER", f"New registration from {email} (waiting for approval)", ip, now_ts()))
    mail_registration_received({"name": name, "email": email})
    return jsonify(ok=True)


@app.get("/api/registrations")
@staff_required("employees.manage")
def list_registrations():
    return jsonify(rows("SELECT id,name,personal_email email,phone,address,gender,joined FROM users WHERE approval='pending' ORDER BY id"))


@app.post("/api/registrations/<int:uid>/decision")
@staff_required("employees.manage")
def decide_registration(uid):
    u = row("SELECT * FROM users WHERE id=? AND approval='pending'", (uid,))
    if not u:
        return jsonify(error="This registration was already handled"), 404
    b = body()
    if b.get("decision") == "approve":
        login, pw = (b.get("email") or "").strip().lower(), b.get("password") or ""
        if "@" not in login or "." not in login.split("@")[-1] or " " in login:
            return jsonify(error="Enter the employee's company email id"), 400
        if len(pw) < 6:
            return jsonify(error="The password must be at least 6 characters"), 400
        if row("SELECT id FROM users WHERE lower(email)=? AND id!=?", (login, uid)):
            return jsonify(error="That email id is already used by someone else"), 400
        execute("UPDATE users SET approval='approved', active=1, email=?, password=?, department=?, designation=? WHERE id=?",
                (login, generate_password_hash(pw), (b.get("department") or "").strip()[:80], (b.get("designation") or "").strip()[:80], uid))
        audit("REGISTRATION_APPROVE", f"Approved {u['name']} as {login}")
        err = mail_credentials(u, login, pw, request.host_url.rstrip("/"))
        return jsonify(ok=True, emailed=not err, error=err, personal_email=u["personal_email"])
    if b.get("decision") == "reject":
        reason = (b.get("reason") or "").strip()[:300]
        execute("UPDATE users SET approval='rejected', active=0 WHERE id=?", (uid,))
        audit("REGISTRATION_REJECT", f"Rejected {u['name']} ({u['personal_email']})")
        mail_rejected(u, reason)
        return jsonify(ok=True)
    return jsonify(error="Invalid decision"), 400


# ----------------------------------------------------------------- settings / permissions / audit

@app.get("/api/settings")
@staff_required()
def get_settings():
    out = {r["key"]: r["value"] for r in rows("SELECT * FROM settings") if not r["key"].startswith("mail_")}
    if "settings.manage" in user_perms(current_user()):
        cfg = mail_config()
        out.update({k: v for k, v in cfg.items() if k != "mail_password"})
        out["mail_password_set"] = bool(cfg["mail_password"])
    return jsonify(out)


@app.put("/api/settings")
@staff_required("settings.manage")
def put_settings():
    b = body()
    allowed = ("company_name", "work_start", "work_end", "late_grace_minutes", "timezone", "week_start") + MAIL_KEYS
    if "mail_port" in b and str(b["mail_port"]).strip() and not str(b["mail_port"]).strip().isdigit():
        return jsonify(error="Mail port must be a number"), 400
    if b.get("mail_password") == "":
        b.pop("mail_password")  # blank means "keep the saved password"
    for k in allowed:
        if k in b:
            execute("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (k, str(b[k])))
    audit("SETTINGS_UPDATE", ", ".join(f"{k}={'***' if k == 'mail_password' else b[k]}" for k in allowed if k in b))
    return jsonify(ok=True)


@app.post("/api/settings/test-email")
@staff_required("settings.manage")
def test_email():
    to = (body().get("to") or "").strip()
    if "@" not in to:
        return jsonify(error="Enter an email address to send the test to"), 400
    co = setting("company_name", "Teamo")
    err = send_mail(to, f"Test email from {co}", f"If you can read this, email from {co} is set up correctly.",
                    mail_html("Email is working", [f"This is a test message from {h(co)}.", "If you can read this, your email settings are correct."]), wait=True)
    if err:
        return jsonify(error=err), 400
    return jsonify(ok=True)


@app.put("/api/account/password")
@login_required
def change_password():
    b = body()
    u = current_user()
    if not check_password_hash(u["password"], b.get("current") or ""):
        return jsonify(error="Current password is incorrect"), 400
    if len(b.get("new") or "") < 6:
        return jsonify(error="New password must be at least 6 characters"), 400
    execute("UPDATE users SET password=? WHERE id=?", (generate_password_hash(b["new"]), u["id"]))
    audit("PASSWORD_CHANGE", "Changed own password")
    return jsonify(ok=True)


@app.get("/api/permissions")
@staff_required()
def get_permissions():
    grants = {(r["role"], r["perm"]): bool(r["allowed"]) for r in rows("SELECT * FROM permissions")}
    staff = [{"key": k, "label": v, "admin": grants.get(("admin", k), True) or ("admin", k) in LOCKED, "manager": grants.get(("manager", k), False),
              "locked_admin": ("admin", k) in LOCKED} for k, v in ALL_PERMS.items()]
    emp = [{"key": k, "label": v, "employee": grants.get(("employee", k), True)} for k, v in EMPLOYEE_PERMS.items()]
    return jsonify(perms=staff, employee_perms=emp)


@app.put("/api/permissions")
@staff_required("permissions.manage")
def put_permissions():
    b = body()
    changed = []
    for role, keys in (("admin", ALL_PERMS), ("manager", ALL_PERMS), ("employee", EMPLOYEE_PERMS)):
        for k in keys:
            if k in (b.get(role) or {}):
                on = bool(b[role][k]) or (role, k) in LOCKED
                execute("INSERT INTO permissions VALUES(?,?,?) ON CONFLICT(role,perm) DO UPDATE SET allowed=excluded.allowed", (role, k, int(on)))
                changed.append(f"{role}.{k}={'on' if on else 'off'}")
    audit("PERMISSIONS_UPDATE", ", ".join(changed))
    return jsonify(ok=True)


@app.get("/api/audit")
@staff_required("audit.view")
def get_audit():
    q = request.args.get("q", "").strip()
    sql, args = "SELECT * FROM audit_log", []
    if q:
        sql += " WHERE action LIKE ? OR details LIKE ? OR user_name LIKE ?"
        args = [f"%{q}%"] * 3
    return jsonify(rows(sql + " ORDER BY id DESC LIMIT 500", args))


# ----------------------------------------------------------------- employee API

def break_minutes(uid, d):
    total, ongoing = 0, False
    for b in rows("SELECT * FROM breaks WHERE user_id=? AND date=?", (uid, d)):
        end = b["end_time"] or now_time()
        ongoing = ongoing or not b["end_time"]
        total += max(0, int(hours_between(b["start_time"], end) * 60 + 0.5))
    return total, ongoing


def today_att(uid):
    a = row("SELECT * FROM attendance WHERE user_id=? AND date=?", (uid, today()))
    if a:
        a["break_minutes"], a["on_break"] = break_minutes(uid, today())
    return a


def my_meetings(uid, d=None):
    sql = ("SELECT m.*, u.name organiser FROM meetings m JOIN meeting_participants mp ON mp.meeting_id=m.id "
           "LEFT JOIN users u ON u.id=m.created_by WHERE mp.user_id=?")
    args = [uid]
    if d:
        sql += " AND m.date=?"
        args.append(d)
    out = []
    for m in rows(sql + " ORDER BY m.date DESC, m.start_time", args):
        m = meeting_with_participants(m)
        r = row("SELECT status FROM meeting_join_requests WHERE meeting_id=? AND user_id=?", (m["id"], uid))
        m["join_status"] = r["status"] if r else "none"
        m["has_link"] = (m["location"] or "").lower().startswith(("http://", "https://", "/meet/"))
        if m["has_link"] and m["join_status"] != "approved":
            m["location"] = ""  # the link stays hidden until a manager approves the request
        out.append(m)
    return out


@app.get("/api/me/dashboard")
@employee_required
def me_dashboard():
    u = current_user()
    tasks = rows("SELECT *, (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=tasks.id) comment_count, (SELECT text FROM task_feedback f WHERE f.task_id=tasks.id ORDER BY f.id DESC LIMIT 1) last_feedback, (SELECT kind FROM task_feedback f WHERE f.task_id=tasks.id ORDER BY f.id DESC LIMIT 1) last_feedback_kind FROM tasks WHERE assigned_to=? AND (due_date<=? AND status!='Approved' OR due_date=?) "
                 "ORDER BY CASE status WHEN 'Approved' THEN 1 ELSE 0 END, CASE priority WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END",
                 (u["id"], today(), today()))
    all_tasks = rows("SELECT status FROM tasks WHERE assigned_to=?", (u["id"],))
    week_from = (date.today() - timedelta(days=date.today().weekday())).isoformat()
    week = rows("SELECT * FROM attendance WHERE user_id=? AND date>=? ORDER BY date", (u["id"], week_from))
    status = u["status"]
    if u["id"] in in_meeting_ids():
        status = "In Meeting"
    return jsonify(user=public_user(u), attendance=today_att(u["id"]), tasks=tasks,
                   meetings=my_meetings(u["id"], today()), status=status, statuses=STATUSES,
                   task_counts={s: sum(1 for t in all_tasks if t["status"] == s) for s in ("Assigned", "In Progress", "Submitted", "Approved")},
                   week_hours=round(sum(hours_between(a["check_in"], a["check_out"] or (now_time() if a["date"] == today() else None))
                                        for a in week), 1),
                   work_start=setting("work_start", "09:30"), work_end=setting("work_end", "18:30"))


@app.get("/api/me/team")
@employee_required
def me_team():
    """Colleagues in the same department, with their live status — so a team can see who's in a call right now."""
    u = current_user()
    if not u["department"]:
        return jsonify([])
    meet_ids = in_meeting_ids()
    team = rows("SELECT id,name,color,department,designation,status FROM users WHERE role='employee' AND active=1 AND department=? AND id!=? ORDER BY name",
                (u["department"], u["id"]))
    return jsonify([{**e, "live_status": "In Meeting" if e["id"] in meet_ids else e["status"]} for e in team])


@app.post("/api/me/checkin")
@employee_required
def me_checkin():
    if (g := needs_perm("attendance.self", "check in")):
        return g
    u = current_user()
    a = today_att(u["id"])
    if a and a["check_in"]:
        return jsonify(error="Already checked in today"), 400
    t = now_time()
    ws = setting("work_start", "09:30")
    grace = int(setting("late_grace_minutes", "10") or 0)
    h, m = map(int, ws.split(":"))
    limit = f"{(h * 60 + m + grace) // 60:02d}:{(h * 60 + m + grace) % 60:02d}"
    st = "Late" if t > limit else "Present"
    if a:
        execute("UPDATE attendance SET check_in=?, status=? WHERE id=?", (t, st, a["id"]))
    else:
        execute("INSERT INTO attendance(user_id,date,check_in,status) VALUES(?,?,?,?)", (u["id"], today(), t, st))
    execute("UPDATE users SET status='Available' WHERE id=?", (u["id"],))
    audit("CHECK_IN", f"Checked in at {t} ({st})")
    return jsonify(ok=True, time=t, status=st)


@app.post("/api/me/checkout")
@employee_required
def me_checkout():
    if (g := needs_perm("attendance.self", "check out")):
        return g
    u = current_user()
    a = today_att(u["id"])
    if not a or not a["check_in"]:
        return jsonify(error="You haven't checked in yet"), 400
    if a["check_out"]:
        return jsonify(error="Already checked out today"), 400
    t = now_time()
    execute("UPDATE breaks SET end_time=? WHERE user_id=? AND date=? AND end_time IS NULL", (t, u["id"], today()))
    execute("UPDATE attendance SET check_out=? WHERE id=?", (t, a["id"]))
    execute("UPDATE users SET status='Offline' WHERE id=?", (u["id"],))
    audit("CHECK_OUT", f"Checked out at {t}")
    return jsonify(ok=True, time=t)


@app.post("/api/me/break/<action>")
@employee_required
def me_break(action):
    if (g := needs_perm("attendance.self", "take breaks")):
        return g
    u = current_user()
    a = today_att(u["id"])
    if not a or not a["check_in"] or a["check_out"]:
        return jsonify(error="You must be checked in to take a break"), 400
    t = now_time()
    open_b = row("SELECT * FROM breaks WHERE user_id=? AND date=? AND end_time IS NULL", (u["id"], today()))
    if action == "start":
        if open_b:
            return jsonify(error="Break already started"), 400
        execute("INSERT INTO breaks(user_id,date,start_time) VALUES(?,?,?)", (u["id"], today(), t))
        execute("UPDATE users SET status='On Break' WHERE id=?", (u["id"],))
    elif action == "end":
        if not open_b:
            return jsonify(error="No break in progress"), 400
        execute("UPDATE breaks SET end_time=? WHERE id=?", (t, open_b["id"]))
        execute("UPDATE users SET status='Available' WHERE id=?", (u["id"],))
    else:
        return jsonify(error="Invalid action"), 400
    audit("BREAK_" + action.upper(), f"Break {action} at {t}")
    return jsonify(ok=True, time=t)


@app.put("/api/me/status")
@employee_required
def me_status():
    st = body().get("status")
    if st not in STATUSES:
        return jsonify(error="Invalid status"), 400
    execute("UPDATE users SET status=? WHERE id=?", (st, current_user()["id"]))
    audit("STATUS_CHANGE", f"Status set to {st}")
    return jsonify(ok=True)


@app.get("/api/me/attendance")
@employee_required
def me_attendance():
    u = current_user()
    recs = rows("SELECT * FROM attendance WHERE user_id=? ORDER BY date DESC LIMIT 60", (u["id"],))
    for r in recs:
        r["hours"] = hours_between(r["check_in"], r["check_out"])
    return jsonify(today=today_att(u["id"]), records=recs)


@app.get("/api/me/tasks")
@employee_required
def me_tasks():
    return jsonify(rows("SELECT t.*, c.name creator, (SELECT COUNT(*) FROM task_comments k WHERE k.task_id=t.id) comment_count, (SELECT text FROM task_feedback f WHERE f.task_id=t.id ORDER BY f.id DESC LIMIT 1) last_feedback, (SELECT kind FROM task_feedback f WHERE f.task_id=t.id ORDER BY f.id DESC LIMIT 1) last_feedback_kind FROM tasks t LEFT JOIN users c ON c.id=t.created_by "
                        "WHERE t.assigned_to=? ORDER BY CASE t.status WHEN 'Approved' THEN 1 ELSE 0 END, t.due_date",
                        (current_user()["id"],)))


@app.put("/api/me/tasks/<int:tid>")
@employee_required
def me_task_update(tid):
    if (g := needs_perm("tasks.work", "work on tasks")):
        return g
    t = row("SELECT * FROM tasks WHERE id=? AND assigned_to=?", (tid, current_user()["id"]))
    if not t:
        return jsonify(error="Task not found"), 404
    b = body()
    st = b.get("status") or t["status"]
    note = (b["note"] if "note" in b else t["work_note"] or "").strip()
    if st not in ("Assigned", "In Progress", "Submitted"):
        return jsonify(error="Invalid status"), 400
    if t["status"] in ("Submitted", "Approved"):
        return jsonify(error=f"This task is already {t['status'].lower()}"), 400
    if st == "Submitted" and not note:
        return jsonify(error="Describe the work you did before submitting"), 400
    execute("UPDATE tasks SET status=?, work_note=?, completed_at=NULL WHERE id=?", (st, note, tid))
    if st != t["status"]:
        n = row("SELECT COUNT(*) c FROM task_attachments WHERE task_id=?", (tid,))["c"]
        if st == "Submitted":
            log_task(tid, "submitted", "submitted the work for review" + (f" with {n} file{'s' if n != 1 else ''}" if n else ""), note)
        else:
            log_task(tid, "status", f"changed status from {t['status']} to {st}")
    elif note != (t["work_note"] or ""):
        log_task(tid, "note", "updated the work notes", note)
    audit("TASK_STATUS", f"Task #{tid} '{t['title']}' -> {st}")
    return jsonify(ok=True)


@app.post("/api/me/meetings/<int:mid>/join-request")
@employee_required
def me_join_request(mid):
    if (g := needs_perm("meetings.join", "join meetings")):
        return g
    u = current_user()
    m = next((x for x in my_meetings(u["id"]) if x["id"] == mid), None)
    if not m or not m["has_link"]:
        return jsonify(error="Meeting not found"), 404
    if m["state"] == "Completed":
        return jsonify(error="This meeting has ended"), 400
    if m["join_status"] in ("pending", "approved"):
        return jsonify(error=f"Your request is already {m['join_status']}"), 400
    execute("INSERT INTO meeting_join_requests VALUES(?,?,'pending',?) ON CONFLICT (meeting_id,user_id) DO UPDATE SET status='pending', ts=EXCLUDED.ts", (mid, u["id"], now_ts()))
    audit("MEETING_JOIN_REQUEST", f"Requested to join '{m['title']}'")
    rc = row("SELECT room_code FROM meetings WHERE id=?", (mid,))
    if rc and rc["room_code"]:
        room_poke(rc["room_code"])
    return jsonify(ok=True)


@app.get("/api/me/meetings")
@employee_required
def me_meetings():
    return jsonify(my_meetings(current_user()["id"]))


@app.get("/api/me/reports")
@employee_required
def me_reports():
    u = current_user()
    d_from, d_to = report_range()
    days = []
    d = date.fromisoformat(d_from)
    att = {a["date"]: a for a in rows("SELECT * FROM attendance WHERE user_id=? AND date BETWEEN ? AND ?", (u["id"], d_from, d_to))}
    while d <= date.fromisoformat(d_to):
        if d.weekday() < 5:
            a = att.get(d.isoformat())
            days.append({"label": d.strftime("%d %b"), "value": hours_between(a["check_in"], a["check_out"]) if a else 0,
                         "status": a["status"] if a else "-"})
        d += timedelta(days=1)
    return jsonify(range={"from": d_from, "to": d_to}, summary=employee_report(u["id"], d_from, d_to), days=days,
                   records=attendance_history(u["id"], d_from, d_to), completed_tasks=completed_tasks(u["id"], d_from, d_to))


@app.put("/api/me/profile")
@employee_required
def me_profile():
    b = body()
    fields = {k: b[k].strip() for k in ("name", "phone") if isinstance(b.get(k), str) and b[k].strip()}
    if fields:
        execute(f"UPDATE users SET {', '.join(k + '=?' for k in fields)} WHERE id=?", (*fields.values(), current_user()["id"]))
        audit("PROFILE_UPDATE", "Updated " + ", ".join(fields))
    return jsonify(ok=True)


@app.errorhandler(404)
def not_found(_e):
    if request.path.startswith("/api/"):
        return jsonify(error="Not found"), 404
    return redirect("/")


# ----------------------------------------------------------------- run

def local_ips():
    ips = {"127.0.0.1"}
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sk:
            sk.connect(("10.255.255.255", 1))  # no traffic is sent; this only picks the outgoing interface
            ips.add(sk.getsockname()[0])
    except OSError:
        pass
    return sorted(ips)


def make_cert():
    """Self-signed certificate for TEAMO_HTTPS=1 (browsers only allow camera/microphone on https or localhost)."""
    d = os.path.join(BASE_DIR, "certs")
    os.makedirs(d, exist_ok=True)
    cert, key, stamp = (os.path.join(d, n) for n in ("cert.pem", "key.pem", "ips.txt"))
    ips = ",".join(local_ips())
    if not (os.path.exists(cert) and os.path.exists(key) and os.path.exists(stamp) and open(stamp).read() == ips):
        san = "DNS:localhost," + ",".join("IP:" + i for i in ips.split(","))
        subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "825",
                        "-subj", "/CN=Teamo", "-addext", f"subjectAltName={san}"], check=True, capture_output=True)
        open(stamp, "w").write(ips)
    return cert, key


if __name__ == "__main__":
    init_db()
    port = int(os.environ.get("PORT", 8000))
    https = os.environ.get("TEAMO_HTTPS") == "1"
    ctx = make_cert() if https else None
    print("\n  ================  TEAMO  ================")
    for ip in (local_ips() if https else ["127.0.0.1"]):
        print(f"  Open  {'https' if https else 'http'}://{ip}:{port}")
    if https:
        print("  (first visit: your browser warns about the self-signed certificate; choose Advanced > Proceed)")
    print("  Admin    : admin@teamo.com   / admin123")
    print("  Employee : priya@teamo.com   / emp123")
    print("  =========================================\n")
    app.run(host="0.0.0.0", port=port, debug=False, ssl_context=ctx)

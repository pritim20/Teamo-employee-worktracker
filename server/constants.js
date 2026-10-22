// Ported verbatim from teamo/main.py — keep these two files in sync if either changes.
const ALL_PERMS = {
  "employees.view": "View employees",
  "employees.manage": "Add / edit / delete employees",
  "tasks.manage": "Create & assign tasks",
  "attendance.manage": "View & mark attendance",
  "meetings.manage": "Schedule meetings",
  "reports.view": "View reports & analytics",
  "settings.manage": "Change system settings",
  "permissions.manage": "Manage role permissions",
  "audit.view": "View audit log",
};

const MANAGER_DEFAULT = Object.fromEntries(
  Object.keys(ALL_PERMS).map((p) => [p, !["settings.manage", "permissions.manage"].includes(p)])
);

const EMPLOYEE_PERMS = {
  "attendance.self": "Check in, take breaks and check out",
  "tasks.work": "Start, update and submit assigned tasks",
  "meetings.join": "Request to join meetings",
};

const LOCKED = [["admin", "permissions.manage"]]; // can't be switched off, so admins can never lock themselves out

const STATUSES = ["Available", "Busy", "In Meeting", "On Break", "Away", "Offline"];

const COLORS = ["#6366f1", "#ec4899", "#f59e0b", "#10b981", "#06b6d4", "#8b5cf6", "#ef4444", "#14b8a6", "#f97316", "#3b82f6"];

const MAIL_KEYS = ["mail_enabled", "mail_host", "mail_port", "mail_user", "mail_password", "mail_from", "mail_from_name"];

module.exports = { ALL_PERMS, MANAGER_DEFAULT, EMPLOYEE_PERMS, LOCKED, STATUSES, COLORS, MAIL_KEYS };

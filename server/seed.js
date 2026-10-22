// One-off bootstrap for a brand new Supabase project, ported from teamo/main.py's
// init_db()/seed() (which ran on every Flask startup — there's no equivalent "startup"
// moment for a Netlify Function, so this is a script you run by hand once after applying
// supabase/schema.sql). Safe to re-run: permissions use ON CONFLICT DO NOTHING, and the
// demo accounts/settings only get created if the users table is still empty.
require("dotenv").config();
const { row, execute } = require("./db");
const { generatePasswordHash } = require("./auth");
const { ALL_PERMS, MANAGER_DEFAULT, EMPLOYEE_PERMS, COLORS } = require("./constants");
const { today, nowTs } = require("./util");

async function seedDemoAccounts() {
  console.log("  Creating demo accounts ...");
  const defaults = {
    company_name: "Teamo Technologies", work_start: "09:30", work_end: "18:30",
    late_grace_minutes: "10", timezone: "Asia/Kolkata", week_start: "Monday",
  };
  for (const [k, v] of Object.entries(defaults)) {
    await execute("INSERT INTO settings VALUES(?,?) ON CONFLICT (key) DO NOTHING", [k, v]);
  }
  const people = [
    ["Aarav Admin", "admin@teamo.com", "admin123", "admin", "Management", "Administrator"],
    ["Priya Sharma", "priya@teamo.com", "emp123", "employee", "Engineering", "Frontend Developer"],
  ];
  for (let i = 0; i < people.length; i++) {
    const [name, email, pw, r, dept, des] = people[i];
    await execute(
      "INSERT INTO users(name,email,password,role,department,designation,phone,joined,status,color) VALUES(?,?,?,?,?,?,?,?,?,?)",
      [name, email, generatePasswordHash(pw), r, dept, des, "", today(), r === "employee" ? "Offline" : "Available", COLORS[i % COLORS.length]]
    );
  }
  await execute("INSERT INTO audit_log(user_id,user_name,action,details,ip,ts) VALUES(1,'System','SEED','Demo accounts created','-',?)", [nowTs()]);
}

async function main() {
  for (const p of Object.keys(ALL_PERMS)) {
    await execute("INSERT INTO permissions VALUES('manager',?,?) ON CONFLICT (role,perm) DO NOTHING", [p, MANAGER_DEFAULT[p] ? 1 : 0]);
    await execute("INSERT INTO permissions VALUES('admin',?,1) ON CONFLICT (role,perm) DO NOTHING", [p]);
  }
  for (const p of Object.keys(EMPLOYEE_PERMS)) {
    await execute("INSERT INTO permissions VALUES('employee',?,1) ON CONFLICT (role,perm) DO NOTHING", [p]);
  }
  const userCount = (await row("SELECT COUNT(*) c FROM users")).c;
  if (userCount === 0) await seedDemoAccounts();
  else console.log(`  ${userCount} user(s) already exist — skipping demo account creation.`);
  console.log("  Permissions seeded.");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });

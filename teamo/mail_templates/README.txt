Teamo email templates
=====================
Edit these files to change the emails Teamo sends. Each email has two files:

  <name>.txt   plain-text version. The FIRST line must be:  Subject: ...
  <name>.html  styled version shown by most mail apps

Emails:
  registered   sent to the personal email when someone registers
  approved     sent to the personal email when a manager approves: company email id + password
  rejected     sent to the personal email when a manager rejects

Placeholders (written as {name}); unknown ones are left as they are:
  {name}          the person's full name
  {company}       company name from Settings
  {employee_id}   e.g. TM-0004
  {login_email}   the company email id the manager assigned   (approved only)
  {password}      the password the manager assigned           (approved only)
  {login_url}     the address to sign in at                   (approved only)
  {reason}        the manager's reason, may be empty          (rejected only)
  {reason_line}   "Reason: ..." or nothing if no reason given (rejected only)

In .html files the values are escaped for you, so names with & or < are safe.
Changes take effect on the next email, no restart needed.

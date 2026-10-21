# Teamo — Employee Work Tracking

One command runs the backend (Flask + SQLite) and serves the frontend.

## Run
```
pip install -r requirements.txt
python main.py
```
Open http://127.0.0.1:8000

The database (`teamo.db`) is created and filled with demo data on first run. Delete it to reset.

## Demo logins
| Portal | Email | Password |
|---|---|---|
| Admin / Manager | admin@teamo.com | admin123 |
| Admin / Manager | manager@teamo.com | manager123 |
| Employee | priya@teamo.com (also rohan, sneha, vikram, ananya, karan, isha, aditya @teamo.com) | emp123 |

## Admin / Manager panel
Dashboard (total employees, present today, in meeting, pending tasks, 7-day attendance, task overview, live team status, today's meetings, recent activity) · Employee Management · Task Management (board + table) · Attendance register · Meeting Management · Reports & Analytics (CSV export) · Settings · Permissions (manager role toggles) · Audit Log · Logout

## Employee panel
Dashboard (today's attendance with check-in/out, today's tasks, meetings, current status picker) · Attendance (calendar + history) · My Tasks · Meetings · My Reports · My Profile · Logout

## Structure
```
main.py              backend API + page routes + DB setup
requirements.txt
frontend/
  login.html admin.html employee.html
  css/style.css
  js/common.js admin.js employee.js
```
Change the port with `PORT=8000 python main.py`. Light/dark mode toggle is in the top bar.

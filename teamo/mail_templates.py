"""Renders the email templates in the mail_templates/ folder (see README.txt there)."""
import os
import re
from html import escape

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "mail_templates")


def _fill(text, values, escape_values):
    # {placeholder} replacement that leaves CSS braces and unknown placeholders alone
    def sub(m):
        key = m.group(1)
        if key not in values:
            return m.group(0)
        v = str(values[key])
        return escape(v) if escape_values else v
    return re.sub(r"\{([a-z_]+)\}", sub, text)


def render(template, /, **values):
    """Returns (subject, text_body, html_body) for the template called `template`."""
    with open(os.path.join(TEMPLATE_DIR, template + ".txt"), encoding="utf-8") as f:
        txt = f.read()
    first, _, rest = txt.partition("\n")
    if not first.lower().startswith("subject:"):
        raise ValueError(f"{template}.txt must start with a 'Subject:' line")
    subject = _fill(first[8:].strip(), values, False)
    text = _fill(rest.lstrip("\n"), values, False).strip() + "\n"
    html = None
    path = os.path.join(TEMPLATE_DIR, template + ".html")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            html = _fill(f.read(), values, True)
    return subject, text, html

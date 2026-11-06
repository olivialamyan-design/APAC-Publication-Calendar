#!/usr/bin/env python3
"""ingest.py - convert the master workbook into data/publications.json.

Thin wrapper around tools/build_publications.py (v6 format: 'Published & Planned'
+ 'Upcoming Recurring' + optional 'Event & Webinar'). Kept so existing commands still work:

    python3 scripts/ingest.py <path-to-xlsx> [--repo-root DIR] [--today YYYY-MM-DD]

An old-format workbook (single 'Publications' sheet) is rejected with a clear
message asking for the new template.
"""
import argparse
import subprocess
import sys
from pathlib import Path

ap = argparse.ArgumentParser()
ap.add_argument("xlsx")
ap.add_argument("--repo-root", default=str(Path(__file__).resolve().parent.parent))
ap.add_argument("--today", default=None)
ap.add_argument("--report", default=None)
a = ap.parse_args()
root = Path(a.repo_root).resolve()
cmd = [sys.executable, str(root / "tools" / "build_publications.py"), "--xlsx", a.xlsx,
       "--out", str(root / "data" / "publications.json")]
if a.today:
    cmd += ["--today", a.today]
if a.report:
    cmd += ["--report", a.report]
cmd += ["--events", str(root / "data" / "events.json")]
sys.exit(subprocess.call(cmd))

#!/usr/bin/env python3
"""Build data/publications.json from the APAC Publication Calendar master xlsx.

Design goals (per Olivia's working rules):
  * Map columns by HEADER NAME, not position — robust to column reorder.
  * Support the new `Lead Author` and `Start Date` fields.
  * Expand recurring series exactly the way the live app expects:
      - one record per occurrence,
      - dates land on the LAST day of each recurring month,
      - projected forward over a fixed window (generation month .. +24 months),
      - occurrences before a series `Start Date` are skipped.
  * Output record shape matches the existing publications.json exactly.

This script is intentionally dependency-light (openpyxl + stdlib) so it runs
the same locally and in CI.

Usage:
    python3 tools/build_publications.py \
        --xlsx APAC-Publication-Calendar-Master-5.xlsx \
        --out  data/publications.json
"""
import argparse
import calendar
import datetime
import json
import re
import sys
import unicodedata

import openpyxl

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DATA_SHEET = "Publications"
HEADER_ROW = 2          # headers live on row 2
FIRST_DATA_ROW = 3      # data starts on row 3
FORWARD_MONTHS = 24     # projection window length (months ahead of gen month)

# Canonical field name  ->  list of acceptable header spellings (lower-cased).
# Header matching is case-insensitive and whitespace-insensitive.
HEADER_ALIASES = {
    "country":                   ["country"],
    "city_state":                ["city / state", "city/state", "city / state ", "city state"],
    "publication_name":          ["publication name"],
    "asset_class":               ["asset class"],
    "publication_type":          ["publication type"],
    "language":                  ["language"],
    "frequency":                 ["frequency"],
    "recurring_months":          ["recurring months"],
    "expected_publication_date": ["expected publication date"],
    "start_date":                ["start date"],
    "team":                      ["team"],
    "lead_author":               ["lead author"],
    "notes":                     ["notes"],
    "report_scope":              ["report scope"],
    "status":                    ["status (future)", "status"],
}

MONTH_LOOKUP = {
    "jan": 1, "january": 1, "feb": 2, "february": 2, "mar": 3, "march": 3,
    "apr": 4, "april": 4, "may": 5, "jun": 6, "june": 6, "jul": 7, "july": 7,
    "aug": 8, "august": 8, "sep": 9, "sept": 9, "september": 9,
    "oct": 10, "october": 10, "nov": 11, "november": 11, "dec": 12, "december": 12,
}


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------

def slugify(text):
    """Lower-case, ASCII, hyphen-separated slug (matches existing ids)."""
    text = "" if text is None else str(text)
    text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode("ascii")
    text = text.lower().strip()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def norm_header(text):
    return re.sub(r"\s+", " ", str(text or "").strip().lower())


def last_day_of_month(year, month):
    return calendar.monthrange(year, month)[1]


def add_months(year, month, n):
    """Return (year, month) n months after the given year/month."""
    idx = (year * 12 + (month - 1)) + n
    return idx // 12, idx % 12 + 1


def parse_date(value):
    """Accept datetime/date or 'YYYY-MM-DD' string -> date | None.

    The string 'TBD' (case-insensitive) returns None and flags TBD upstream.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime.datetime):
        return value.date()
    if isinstance(value, datetime.date):
        return value
    s = str(value).strip()
    if s.upper() == "TBD" or s == "":
        return None
    try:
        return datetime.date.fromisoformat(s[:10])
    except ValueError:
        return None


def is_tbd_value(value):
    return value is not None and str(value).strip().upper() == "TBD"


def parse_recurring_months(value, where=""):
    """Parse 'May; Sep' / 'Jan, Apr, Jul, Oct' / '2,5,8,11' -> sorted int list.

    Unrecognised tokens are reported to stderr (NOT silently corrected) so
    source-data typos surface to the operator rather than being papered over.
    """
    if value is None:
        return []
    tokens = re.split(r"[;,/]+|\s+and\s+", str(value))
    months = []
    for tok in tokens:
        tok = tok.strip().lower()
        if not tok:
            continue
        if tok.isdigit():
            m = int(tok)
            if 1 <= m <= 12:
                months.append(m)
            else:
                print(f"  ! {where}: month number out of range: {tok!r}", file=sys.stderr)
        elif tok in MONTH_LOOKUP:
            months.append(MONTH_LOOKUP[tok])
        elif tok[:3] in MONTH_LOOKUP:
            months.append(MONTH_LOOKUP[tok[:3]])
        else:
            print(f"  ! {where}: unrecognised month token {tok!r} in Recurring Months "
                  f"(check for typos, e.g. 'un' vs 'Jun')", file=sys.stderr)
    return sorted(set(months))


def parse_asset_class(value):
    """Asset class may hold multiple values separated by ; , / -> list[str]."""
    if value is None:
        return []
    parts = re.split(r"[;,/]+", str(value))
    return [p.strip() for p in parts if p.strip()]


def clean_text(value):
    if value is None:
        return None
    s = str(value).strip()
    return s or None


# ---------------------------------------------------------------------------
# Core build
# ---------------------------------------------------------------------------

def build_header_map(ws):
    """Map canonical field -> column index (1-based) using header aliases."""
    found = {}
    for col in range(1, ws.max_column + 1):
        h = norm_header(ws.cell(row=HEADER_ROW, column=col).value)
        if not h:
            continue
        for field, aliases in HEADER_ALIASES.items():
            if h in [norm_header(a) for a in aliases]:
                found[field] = col
                break
    missing = [f for f in ("country", "publication_name") if f not in found]
    if missing:
        raise SystemExit(f"Required column(s) not found by header name: {missing}")
    return found


def occurrences_in_window(recurring_months, gen_year, gen_month, start_date):
    """Yield date objects (last-day-of-month) for every recurring occurrence
    inside [gen month .. gen month + FORWARD_MONTHS], honouring start_date."""
    win_start = datetime.date(gen_year, gen_month, 1)
    end_year, end_month = add_months(gen_year, gen_month, FORWARD_MONTHS)
    win_end = datetime.date(end_year, end_month, last_day_of_month(end_year, end_month))

    out = []
    # Walk every month in the window; emit if month is a recurring month.
    y, m = gen_year, gen_month
    cur = datetime.date(y, m, 1)
    while cur <= win_end:
        if m in recurring_months:
            d = datetime.date(y, m, last_day_of_month(y, m))
            if d >= win_start and (start_date is None or d >= start_date):
                out.append(d)
        y, m = add_months(y, m, 1)
        cur = datetime.date(y, m, 1)
    return out


def build_records(ws, hmap, gen_date):
    gen_year, gen_month = gen_date.year, gen_date.month
    records = []

    def cell(row, field):
        col = hmap.get(field)
        return ws.cell(row=row, column=col).value if col else None

    for row in range(FIRST_DATA_ROW, ws.max_row + 1):
        name = clean_text(cell(row, "publication_name"))
        country = clean_text(cell(row, "country"))
        if not name and not country:
            continue  # blank row
        if not name:
            print(f"  ! row {row}: missing Publication Name — skipped", file=sys.stderr)
            continue

        country = country or ""
        frequency = clean_text(cell(row, "frequency")) or "Ad Hoc"
        recurring_months = parse_recurring_months(cell(row, "recurring_months"),
                                                   where=f"row {row} ({name})")
        start_date = parse_date(cell(row, "start_date"))

        exp_raw = cell(row, "expected_publication_date")
        exp_date = parse_date(exp_raw)
        tbd = is_tbd_value(exp_raw) or (exp_date is None and exp_raw not in (None, ""))

        base = {
            "country": country,
            "city_state": clean_text(cell(row, "city_state")) or "",
            "asset_class": parse_asset_class(cell(row, "asset_class")),
            "publication_type": clean_text(cell(row, "publication_type")) or "",
            "language": clean_text(cell(row, "language")) or "English",
            "frequency": frequency,
            "recurring_months": recurring_months,
            "team": clean_text(cell(row, "team")) or "",
            "lead_author": clean_text(cell(row, "lead_author")) or "",
            "notes": clean_text(cell(row, "notes")),
            "report_scope": clean_text(cell(row, "report_scope")) or "",
            "status": clean_text(cell(row, "status")),
            "publication_name": name,
            "start_date": start_date.isoformat() if start_date else None,
        }

        # Stable id seed: r{spreadsheet row} keeps ids unique & deterministic.
        seed = f"{slugify(country)}--{slugify(name)}--r{row}"

        is_recurring = bool(recurring_months) and frequency.lower() not in ("ad hoc", "one-off", "")

        if is_recurring:
            dates = occurrences_in_window(recurring_months, gen_year, gen_month, start_date)
            for d in dates:
                rec = dict(base)
                rec["id"] = f"{seed}--{d.strftime('%Y-%m')}"
                rec["parent_id"] = seed
                rec["recurring"] = True
                rec["expected_publication_date"] = d.isoformat()
                rec["is_tbd"] = False
                records.append(rec)
            if not dates:
                print(f"  · row {row}: recurring series '{name}' produced 0 occurrences "
                      f"(check Start Date / Recurring Months)", file=sys.stderr)
        else:
            rec = dict(base)
            rec["id"] = seed
            rec["parent_id"] = None
            rec["recurring"] = False
            rec["expected_publication_date"] = exp_date.isoformat() if exp_date else None
            rec["is_tbd"] = bool(tbd)
            records.append(rec)

    return records


def main():
    ap = argparse.ArgumentParser(description="Build publications.json from master xlsx")
    ap.add_argument("--xlsx", default="APAC-Publication-Calendar-Master-5.xlsx")
    ap.add_argument("--out", default="data/publications.json")
    ap.add_argument("--sheet", default=DATA_SHEET)
    ap.add_argument("--gen-date", default=None,
                    help="Override generation date (YYYY-MM-DD); defaults to today (UTC).")
    args = ap.parse_args()

    gen_date = (datetime.date.fromisoformat(args.gen_date)
                if args.gen_date else datetime.datetime.now(datetime.UTC).date())

    wb = openpyxl.load_workbook(args.xlsx, data_only=True)
    ws = wb[args.sheet] if args.sheet in wb.sheetnames else wb[DATA_SHEET]
    hmap = build_header_map(ws)
    print(f"Header map: {hmap}")

    records = build_records(ws, hmap, gen_date)

    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(records, f, ensure_ascii=False, indent=2)

    n_rec = sum(1 for r in records if r["recurring"])
    n_one = len(records) - n_rec
    print(f"Wrote {len(records)} records ({n_one} one-off, {n_rec} recurring instances) "
          f"-> {args.out}  [gen month {gen_date:%Y-%m}, +{FORWARD_MONTHS}mo window]")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Build data/publications.json from the APAC Publication Calendar master xlsx (v6, 2026-11-06).

v5 workbook format (two simple sheets):
  * Published           - one row per issue already out, or with an exact known date
                          (incl. Ad Hoc). Columns include Period, Publication Date
                          (YYYY-MM-DD or the text "Date TBC"), Savills URL, Planned Date,
                          Source Check.
  * Upcoming Recurring  - one row per recurring series. Columns include Frequency,
                          Recurring Months, Period Label Style, Recurring Timing Window,
                          Next Date (if known) and a hidden backend Start Date.

Engine rules:
  * Published rows are shown as-is (exact dates). Date TBC rows go to the TBD panel
    with a "needs date" tag. Published rows are always Date Confidence = Confirmed.
  * Published rows are matched to series by Publication Name + Period (never by
    calendar month). If a Published row exists for a period, no estimated instance
    is generated for it.
  * Only FUTURE instances are generated: periods after the latest Published period
    of the series, projected FORWARD_MONTHS ahead of the build date.
  * Date for each generated instance, in priority order:
       a. Next Date (if known), when set and >= build date: used for the FIRST
          generated instance only -> Confirmed. A past Next Date is ignored and
          reported as a data check.
       b. Recurring Timing Window: Early 5th / Mid 15th / Late 25th, weekend moved to
          the previous business day -> Estimated.
       c. Fallback: last business day of the month -> Estimated.
       d. Nothing usable -> TBD.
  * Nothing before 2026-01-01 is generated. Date Confidence is always automatic.
  * Displayed title = Publication Name + " " + Period (except Period Label Style
    Custom, or when the name already ends with the period label).
  * An old-format workbook (single "Publications" sheet) is rejected with a clear
    message asking for the new template.

Usage:
    python3 tools/build_publications.py --xlsx MASTER.xlsx --out data/publications.json
            [--today YYYY-MM-DD] [--report build_report.json]
"""
import argparse
import calendar
import datetime as dt
import json
import re
import sys
import unicodedata

import openpyxl

FORWARD_MONTHS = 24
FLOOR = dt.date(2026, 1, 1)
PUB_SHEET = "Published & Planned"
PUB_SHEET_ALIASES = ["Published & Planned", "Published"]
EVT_SHEET = "Event & Webinar"
UPC_SHEET = "Upcoming Recurring"
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
MONTH_TOKENS = {m.lower(): i + 1 for i, m in enumerate(MONTHS)}
MONTH_TOKENS.update({calendar.month_name[i].lower(): i for i in range(1, 13)})
MONTH_TOKENS.update({"sept": 9, "un": 6})
WINDOW_DAY = {"Early month": 5, "Mid-month": 15, "Late month": 25}
WINDOW_FIX = {"early month": "Early month", "early": "Early month", "mid-month": "Mid-month",
              "mid month": "Mid-month", "mid": "Mid-month", "late month": "Late month",
              "late": "Late month", "tbd": "TBD"}
FREQ_FIX = {"annually": "Annually", "annual": "Annually", "yearly": "Annually",
            "biannually": "Biannually", "biannual": "Biannually", "semi-annual": "Biannually",
            "semiannual": "Biannually", "quarterly": "Quarterly", "monthly": "Monthly"}
STYLE_FIX = {"quarter": "Quarter", "half-year": "Half-year", "half year": "Half-year", "half": "Half-year",
             "month": "Month", "year": "Year", "custom": "Custom"}
COUNTRY_FIX = {"korea": "South Korea", "south korea": "South Korea", "global research": "Global",
               "global": "Global", "asia pacific": "Asia Pacific", "asia-pacific": "Asia Pacific",
               "apac": "Asia Pacific", "hk": "Hong Kong", "prc": "China"}
LANG_FIX = {"traditional chinese": "Chinese (Traditional)", "simplified chinese": "Chinese (Simplified)",
            "chinese": "Chinese (Simplified)", "eng": "English"}
ASSET_FIX = {"hotels": "Hospitality", "hotel": "Hospitality", "i&l": "Industrial & Logistics",
             "logistics": "Industrial & Logistics", "data center": "Data Centres",
             "data centers": "Data Centres", "data centre": "Data Centres"}
TBC_TEXT = {"date tbc", "tbc", "tbd"}
NO_PERIOD = {"", "ad hoc / none", "ad hoc", "none", "-"}

PUB_HEADERS = {
    "country": ["country"], "city_state": ["city / state", "city/state", "city state"],
    "publication_name": ["publication name"], "period": ["period"],
    "publication_date": ["publication date"], "savills_url": ["savills url", "url"],
    "planned_date": ["planned date"], "source_check": ["source check"],
    "asset_class": ["asset class"], "publication_type": ["publication type"],
    "language": ["language"], "team": ["team"], "lead_author": ["lead author"],
    "notes": ["notes"], "report_scope": ["report scope"], "status": ["status", "status (future)"],
}
UPC_HEADERS = {
    "country": ["country"], "city_state": ["city / state", "city/state", "city state"],
    "publication_name": ["publication name"], "asset_class": ["asset class"],
    "publication_type": ["publication type"], "language": ["language"],
    "frequency": ["frequency"], "recurring_months": ["recurring months"],
    "period_label_style": ["period label style"],
    "recurring_timing_window": ["recurring timing window", "timing window"],
    "next_date": ["next date (if known)", "next date"], "team": ["team"],
    "lead_author": ["lead author"], "notes": ["notes"], "report_scope": ["report scope"],
    "status": ["status", "status (future)"],
    "start_date": ["start date (backend, auto)", "start date"],
}


class FormatError(Exception):
    pass


# ---------------------------------------------------------------- helpers
def slugify(text):
    s = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()[:60] or "item"


def norm_header(h):
    return re.sub(r"\s+", " ", str(h or "")).strip().lower()


def text(v):
    if v is None:
        return None
    s = re.sub(r"\s+", " ", str(v)).strip()
    return s or None


def parse_date(v):
    if v is None:
        return None
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    s = str(v).strip()
    for f in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y", "%d %b %Y", "%d %B %Y"):
        try:
            return dt.datetime.strptime(s, f).date()
        except ValueError:
            pass
    return None


def is_business_day(d):
    return d.weekday() < 5


def prev_business_day(d):
    while not is_business_day(d):
        d -= dt.timedelta(days=1)
    return d


def last_business_day(y, m):
    return prev_business_day(dt.date(y, m, calendar.monthrange(y, m)[1]))


def estimate(y, m, window):
    if window in WINDOW_DAY:
        d = prev_business_day(dt.date(y, m, WINDOW_DAY[window]))
        if d.month != m:  # never leave the month (e.g. 5th falls on Sat 1st+)
            d = dt.date(y, m, WINDOW_DAY[window])
            while not is_business_day(d):
                d += dt.timedelta(days=1)
        return d, "Estimated"
    return last_business_day(y, m), "Estimated"


def add_months(y, m, n):
    t = y * 12 + (m - 1) + n
    return t // 12, t % 12 + 1


def parse_months(v):
    if v is None or not str(v).strip():
        return [], []
    ok, bad = [], []
    for p in re.split(r"[;,/]", str(v)):
        p = p.strip().lower()
        if not p:
            continue
        (ok.append(MONTH_TOKENS[p]) if p in MONTH_TOKENS else bad.append(p))
    return sorted(set(ok)), bad


def norm_country(v):
    s = text(v) or ""
    return COUNTRY_FIX.get(s.lower(), s) or None


def norm_langs(v):
    if not v:
        return "English"
    out = [LANG_FIX.get(p.strip().lower(), p.strip()) for p in re.split(r"[;,]", str(v)) if p.strip()]
    return "; ".join(out) or "English"


def norm_assets(v):
    if not v:
        return []
    return [ASSET_FIX.get(p.strip().lower(), p.strip()) for p in re.split(r";", str(v)) if p.strip()]


# ---------------------------------------------------------------- periods
def period_parse(label):
    """Return (kind, year, index) for a period label, or None."""
    if not label:
        return None
    s = label.strip()
    m = re.match(r"^Q([1-4])\s*[/ ]?\s*(\d{4})$", s, re.I)
    if m:
        return ("Quarter", int(m[2]), int(m[1]))
    m = re.match(r"^([12])H\s*(\d{4})$", s, re.I) or re.match(r"^H([12])\s*(\d{4})$", s, re.I)
    if m:
        return ("Half-year", int(m[2]), int(m[1]))
    m = re.match(r"^([A-Za-z]{3})[a-z]*\s+(\d{4})$", s)
    if m and m[1].lower() in MONTH_TOKENS:
        return ("Month", int(m[2]), MONTH_TOKENS[m[1].lower()])
    m = re.match(r"^(\d{4})$", s)
    if m:
        return ("Year", int(m[1]), 1)
    return None


def period_label(kind, y, i):
    return {"Quarter": f"Q{i} {y}", "Half-year": f"{i}H {y}", "Month": f"{MONTHS[i - 1]} {y}",
            "Year": f"{y}"}[kind]


def period_ord(kind, y, i):
    per = {"Quarter": 4, "Half-year": 2, "Month": 12, "Year": 1}[kind]
    return y * per + (i - 1)


def ord_to_period(kind, o):
    per = {"Quarter": 4, "Half-year": 2, "Month": 12, "Year": 1}[kind]
    return o // per, o % per + 1


def canon_period(label):
    p = period_parse(label)
    return period_label(*p) if p else (label.strip() if label else None)


def default_period_for_slot(kind, y, m):
    """Period an issue released in slot month m covers when no anchor exists:
    the latest period whose end month is <= m (current period if m is a period end)."""
    if kind == "Quarter":
        q = m // 3
        return (y, q) if q >= 1 else (y - 1, 4)
    if kind == "Half-year":
        h = m // 6
        return (y, h) if h >= 1 else (y - 1, 2)
    if kind == "Year":
        return (y, 1)
    return (y, m)


# ---------------------------------------------------------------- sheet reading
def find_header(ws, aliases):
    for r in range(1, min(ws.max_row, 12) + 1):
        cells = {norm_header(ws.cell(r, c).value): c for c in range(1, ws.max_column + 1)}
        if "publication name" in cells:
            hmap = {}
            for field, names in aliases.items():
                for n in names:
                    if n in cells:
                        hmap[field] = cells[n]
                        break
            return r, hmap
    raise FormatError(f"Sheet '{ws.title}': could not find the header row (no 'Publication Name' column).")


def read_rows(ws, aliases):
    hr, hmap = find_header(ws, aliases)
    out = []
    for r in range(hr + 1, ws.max_row + 1):
        row = {f: ws.cell(r, c).value for f, c in hmap.items()}
        if text(row.get("publication_name")):
            row["_row"] = r
            out.append(row)
    return out, hmap


def load_workbook(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    names = wb.sheetnames
    global PUB_SHEET
    for alias in PUB_SHEET_ALIASES:
        if alias in names:
            PUB_SHEET = alias
            break
    if PUB_SHEET not in names or UPC_SHEET not in names:
        if "Publications" in names:
            raise FormatError(
                "This is the OLD master format (single 'Publications' sheet). Please use the new template "
                "with the 'Published & Planned' and 'Upcoming Recurring' sheets (APAC-Publication-Calendar-Master_<date>.xlsx). "
                "Nothing was written.")
        raise FormatError(f"Workbook must contain sheets '{PUB_SHEET}' and '{UPC_SHEET}'. Found: {names}")
    return wb


# ---------------------------------------------------------------- build
def build(path, today):
    wb = load_workbook(path)
    pub_rows, _ = read_rows(wb[PUB_SHEET], PUB_HEADERS)
    upc_rows, uh = read_rows(wb[UPC_SHEET], UPC_HEADERS)
    checks, records = [], []

    def check(sheet, row, name, msg, level="warning"):
        checks.append({"sheet": sheet, "row": row, "publication_name": name, "level": level, "message": msg})

    # ---- series
    series = {}
    for u in upc_rows:
        name = text(u["publication_name"])
        if name in series:
            check(UPC_SHEET, u["_row"], name, "Duplicate series name - second row ignored.", "error")
            continue
        freq = FREQ_FIX.get((text(u.get("frequency")) or "").lower())
        months, bad = parse_months(u.get("recurring_months"))
        if freq == "Monthly" and not months:
            months = list(range(1, 13))
        if bad:
            check(UPC_SHEET, u["_row"], name, f"Unrecognised month tokens {bad}.", "error")
        if not freq:
            check(UPC_SHEET, u["_row"], name, "Frequency missing or not recognised.", "error")
        if not months:
            check(UPC_SHEET, u["_row"], name, "Recurring Months missing.", "error")
        style = STYLE_FIX.get((text(u.get("period_label_style")) or "").lower())
        if not style:
            style = {"Quarterly": "Quarter", "Biannually": "Half-year", "Monthly": "Month",
                     "Annually": "Year"}.get(freq, "Custom")
            check(UPC_SHEET, u["_row"], name, f"Period Label Style missing - assumed {style}.")
        win_raw = text(u.get("recurring_timing_window"))
        window = WINDOW_FIX.get((win_raw or "").lower())
        # v6: Next Date retired - exact future dates are 'planned' rows in Published & Planned.
        nd = None
        if parse_date(u.get("next_date")):
            check(UPC_SHEET, u["_row"], name,
                  "Next Date is no longer used - add a 'planned' row in Published & Planned instead (value ignored).")
        sd = u.get("start_date") if "start_date" in uh else None
        sd = parse_date(sd) if not (isinstance(sd, str) and sd.startswith("=")) else None
        series[name] = {
            "row": u["_row"], "name": name, "freq": freq, "months": months, "style": style,
            "window": window, "next_date": nd, "start": sd,
            "base": {
                "country": norm_country(u.get("country")), "city_state": text(u.get("city_state")),
                "asset_class": norm_assets(u.get("asset_class")),
                "publication_type": text(u.get("publication_type")), "language": norm_langs(u.get("language")),
                "team": text(u.get("team")), "lead_author": text(u.get("lead_author")),
                "notes": text(u.get("notes")), "report_scope": text(u.get("report_scope")) or "In-Country",
                "status": (text(u.get("status")) or "").lower() or None,
            },
            "published": {},  # canonical period label -> date or None
        }

    def display(name, period, style):
        if not period or style == "Custom":
            return name
        if name.lower().endswith(period.lower()):
            return name
        return f"{name} {period}"

    # ---- published rows
    seen = {}
    for p in pub_rows:
        name = text(p["publication_name"])
        per_v = p.get("period")
        if isinstance(per_v, (dt.date, dt.datetime)):  # Excel turned "Nov 2026" into a date
            per_v = f"{MONTHS[per_v.month - 1]} {per_v.year}"
        per_raw = text(per_v)
        period = None if (per_raw or "").lower() in NO_PERIOD else canon_period(per_raw)
        key = (name.lower(), (period or "").lower())
        raw_date = p.get("publication_date")
        pdate = parse_date(raw_date)
        tbc = pdate is None
        if tbc and text(raw_date) and text(raw_date).lower() not in TBC_TEXT:
            check(PUB_SHEET, p["_row"], name, f"Publication Date '{raw_date}' not recognised - treated as Date TBC.", "error")
        if pdate and pdate < FLOOR:
            check(PUB_SHEET, p["_row"], name, f"Publication Date {pdate} is before 2026-01-01 - skipped.")
            continue
        s = series.get(name)
        if key in seen and period:
            check(PUB_SHEET, p["_row"], name, f"Duplicate Publication Name + Period ({period}) - row ignored.", "error")
            continue
        seen[key] = True
        if s and not period:
            check(PUB_SHEET, p["_row"], name, "Recurring series row has no Period - it cannot be matched to the series.")
        if s and period:
            pp = period_parse(period)
            if s["style"] in ("Quarter", "Half-year", "Month", "Year") and pp and pp[0] != s["style"]:
                check(PUB_SHEET, p["_row"], name, f"Period '{period}' does not match the series style ({s['style']}).")
            s["published"][period] = pdate
            if pdate:
                s["latest_date"] = max(s.get("latest_date") or pdate, pdate)
            if pdate and s["months"] and pdate.month not in s["months"]:
                check(PUB_SHEET, p["_row"], name,
                      f"Warning: {period} published in {MONTHS[pdate.month - 1]}, outside the usual months "
                      f"({'; '.join(MONTHS[m - 1] for m in s['months'])}).", "review")
        src = text(p.get("source_check"))
        notes = text(p.get("notes"))
        if tbc:
            check(PUB_SHEET, p["_row"], name, f"{period or 'Ad Hoc'}: TBD - add the exact date when known.", "tbd")
        if src and src.lower().startswith("not found"):
            check(PUB_SHEET, p["_row"], name, f"{period or 'Ad Hoc'}: not found on Savills listing - manual input needed.")
        if notes and "listing shows" in notes.lower():
            check(PUB_SHEET, p["_row"], name, f"{period or 'Ad Hoc'}: web listing date differs from team date ({notes}).")
        style = s["style"] if s else None
        status_raw = (text(p.get("status")) or "").lower()
        if status_raw not in ("published", "planned"):
            if status_raw:
                check(PUB_SHEET, p["_row"], name, f"Status '{status_raw}' not recognised - use published or planned.", "error")
            status_raw = "published" if (pdate and pdate <= today) else "planned"
        overdue = False
        if status_raw == "published" and tbc:
            check(PUB_SHEET, p["_row"], name, "Status is published but the date is TBD - shown in the TBD panel.", "error")
        if status_raw == "published" and pdate and pdate > today:
            check(PUB_SHEET, p["_row"], name,
                  f"Status is published but the date {pdate} is in the future - shown as Confirmed (not published).", "review")
        if status_raw == "planned" and pdate and pdate < today:
            overdue = True
            check(PUB_SHEET, p["_row"], name,
                  f"{period or 'Ad Hoc'}: planned date {pdate} has passed - check if it is out (set Status = published) "
                  f"or update the date.", "review")
        is_published = bool(status_raw == "published" and pdate and pdate <= today)
        base = s["base"] if s else {}
        rec = {
            "country": norm_country(p.get("country")) or base.get("country"),
            "city_state": text(p.get("city_state")) or base.get("city_state"),
            "publication_name": display(name, period, style),
            "base_name": name,
            "period": period,
            "asset_class": norm_assets(p.get("asset_class")) or base.get("asset_class", []),
            "publication_type": text(p.get("publication_type")) or base.get("publication_type"),
            "language": norm_langs(p.get("language") or base.get("language")),
            "team": text(p.get("team")) or base.get("team"),
            "lead_author": text(p.get("lead_author")) or base.get("lead_author"),
            "notes": notes,
            "report_scope": text(p.get("report_scope")) or base.get("report_scope") or "In-Country",
            "status": status_raw,
            "frequency": s["freq"] if s else "Ad Hoc",
            "recurring_months": s["months"] if s else [],
            "start_date": None,
            "recurring_timing_window": None,
            "id": f"{slugify(norm_country(p.get('country')) or 'x')}--{slugify(name)}--"
                  f"{slugify(period) if period else (pdate.isoformat() if pdate else 'tbc')}",
            "parent_id": f"{slugify(base.get('country') or 'x')}--{slugify(name)}" if s else None,
            "recurring": False,
            "record_type": ("published" if is_published else "planned") if s else "adhoc",
            "published": is_published,
            "needs_date": tbc,
            "overdue": overdue,
            "expected_publication_date": pdate.isoformat() if pdate else None,
            "is_tbd": tbc,
            "date_confidence": "TBD" if tbc else "Confirmed",
            "savills_url": text(p.get("savills_url")),
            "source_check": src,
            "planned_date": parse_date(p.get("planned_date")).isoformat() if parse_date(p.get("planned_date")) else None,
        }
        records.append(rec)

    # ---- generate future instances per series
    horizon_y, horizon_m = add_months(today.year, today.month, FORWARD_MONTHS)
    horizon = dt.date(horizon_y, horizon_m, calendar.monthrange(horizon_y, horizon_m)[1])
    for s in series.values():
        if not s["months"] or not s["freq"]:
            continue
        kind = s["style"] if s["style"] != "Custom" else "Month"
        slots = []
        y0 = 2025
        for y in range(y0, horizon.year + 1):
            for m in s["months"]:
                slots.append((y, m))
        slots.sort()
        pubs = s["published"]
        # mapping slot -> period ordinal
        parsed = {lab: period_parse(lab) for lab in pubs}
        valid = {lab: pp for lab, pp in parsed.items() if pp and pp[0] == kind}
        if kind in ("Month",):
            slot_period = {sl: period_ord("Month", sl[0], sl[1]) for sl in slots}
        elif kind == "Year":
            slot_period = {sl: sl[0] for sl in slots}
        else:
            slot_period = {sl: period_ord(kind, *default_period_for_slot(kind, *sl)) for sl in slots}
            dated = [(pubs[lab], lab) for lab in valid if pubs[lab]]
            if dated:
                adate, alab = max(dated)
                aord = period_ord(*valid[alab])
                # nearest slot to the anchor date
                def sdist(sl):
                    est, _ = estimate(sl[0], sl[1], s["window"])
                    return abs((est - adate).days)
                aslot = min(slots, key=sdist)
                ai = slots.index(aslot)
                slot_period = {sl: aord + (i - ai) for i, sl in enumerate(slots)}
        latest = max((period_ord(*pp) for pp in valid.values()), default=None)
        pub_ords = {period_ord(*pp) for pp in valid.values()}
        first = True
        overdue = []
        for sl in slots:
            o = slot_period[sl]
            if latest is not None and o <= latest:
                continue
            # never project into (or before) the month of the latest known issue (published or planned)
            if s.get("latest_date") and (sl[0], sl[1]) <= (s["latest_date"].year, s["latest_date"].month):
                continue
            if o in pub_ords:
                continue
            est, conf = estimate(sl[0], sl[1], s["window"])
            if s["start"] and est < s["start"] and not (first and s["next_date"]):
                continue
            if est < FLOOR:
                continue
            if first and s["next_date"]:
                date_, conf = s["next_date"], "Confirmed"
            else:
                date_ = est
            if date_ > horizon:
                break
            if date_ < today:
                overdue.append(period_label(kind, *ord_to_period(kind, o)))
                first = False
                continue
            first = False
            py, pi = ord_to_period(kind, o)
            plabel = period_label(kind, py, pi)
            if plabel in s["published"] or plabel in s.setdefault("_gen", set()):
                continue  # never two instances for the same period
            s["_gen"].add(plabel)
            base = s["base"]
            records.append(dict(base, **{
                "publication_name": display(s["name"], plabel, s["style"]),
                "base_name": s["name"],
                "period": plabel,
                "frequency": s["freq"],
                "recurring_months": s["months"],
                "start_date": s["start"].isoformat() if s["start"] else None,
                "recurring_timing_window": s["window"],
                "id": f"{slugify(base['country'] or 'x')}--{slugify(s['name'])}--{slugify(plabel)}",
                "parent_id": f"{slugify(base['country'] or 'x')}--{slugify(s['name'])}",
                "recurring": True,
                "record_type": "projected",
                "published": False,
                "needs_date": False,
                "overdue": False,
                "status": "planned",
                "expected_publication_date": date_.isoformat(),
                "is_tbd": False,
                "date_confidence": conf,
                "savills_url": None,
                "source_check": None,
                "planned_date": None,
            }))
        if overdue:
            check(UPC_SHEET, s["row"], s["name"],
                  f"Expected issue(s) {', '.join(overdue)} are past their estimated date but not in Published - "
                  f"add them to Published & Planned (or TBD).", "review")
        if s["next_date"] and first:
            check(UPC_SHEET, s["row"], s["name"], "Next Date set but no future instance to apply it to.")

    # ---- ids unique
    ids = {}
    for r in records:
        if r["id"] in ids:
            ids[r["id"]] += 1
            r["id"] = f"{r['id']}--{ids[r['id']]}"
        else:
            ids[r["id"]] = 1
    records.sort(key=lambda p: (1 if p["is_tbd"] else 0, p["expected_publication_date"] or "9999",
                                p["publication_name"]))
    return records, checks


def build_events(xlsx, out_path, checks):
    """Rebuild data/events.json from the 'Event & Webinar' sheet (Date, Name, Type, Market, Venue,
    Organiser, Audience, Link). Rows with Date = TBD are skipped (events need a date) and reported."""
    import hashlib
    wb = openpyxl.load_workbook(xlsx, data_only=True)
    if EVT_SHEET not in wb.sheetnames:
        return {"status": "skipped", "reason": f"no '{EVT_SHEET}' sheet"}
    ws = wb[EVT_SHEET]
    hr = None
    for r in range(1, 8):
        if norm_header(ws.cell(r, 2).value) == "date" or any(norm_header(ws.cell(r, c).value) == "name" for c in range(1, 12)):
            hr = r
            break
    cols = {norm_header(ws.cell(hr, c).value): c for c in range(1, ws.max_column + 1) if ws.cell(hr, c).value}
    def g(r, k):
        return ws.cell(r, cols[k]).value if k in cols else None
    events, skipped = [], []
    for r in range(hr + 1, ws.max_row + 1):
        name = text(g(r, "name"))
        if not name:
            continue
        d0 = parse_date(g(r, "date"))
        if not d0:
            skipped.append(name)
            checks.append({"sheet": EVT_SHEET, "row": r, "publication_name": name, "level": "tbd",
                           "message": "Event date TBD - not shown on the site until a date is added."})
            continue
        market = norm_country(g(r, "market")) or "Global"
        venue = text(g(r, "venue"))
        link = text(g(r, "link"))
        link = link if link and link.lower().startswith("http") else None
        city = "Online" if (venue or "").lower() == "online" else (venue.split(",")[-1].strip() if venue else None)
        h = hashlib.sha1(f"{name}|{d0.isoformat()}".encode()).hexdigest()[:6]
        events.append({
            "id": f"{slugify(market)}--{slugify(name)}--{h}", "name": name,
            "start_date": d0.isoformat(), "end_date": d0.isoformat(), "market": market,
            "city": city, "venue": venue, "event_type": text(g(r, "type")) or "Event",
            "organiser": text(g(r, "organiser")), "audience": text(g(r, "audience")),
            "link": link, "notes": None,
        })
    events.sort(key=lambda e: e["start_date"])
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump({"generated_at": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
                   "events": events}, f, indent=1, ensure_ascii=False)
        f.write("\n")
    return {"status": "OK", "output": out_path, "events": len(events), "skipped_tbd": skipped}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--xlsx", required=True)
    ap.add_argument("--out", default="data/publications.json")
    ap.add_argument("--today", default=None, help="Build date YYYY-MM-DD (default: today)")
    ap.add_argument("--report", default=None, help="Optional path for the data-check report JSON")
    ap.add_argument("--events", default=None,
                    help="Optional: also rebuild this events.json from the 'Event & Webinar' sheet")
    a = ap.parse_args()
    today = dt.date.fromisoformat(a.today) if a.today else dt.date.today()
    try:
        records, checks = build(a.xlsx, today)
    except FormatError as e:
        print(json.dumps({"status": "FORMAT_ERROR", "message": str(e)}, indent=2))
        sys.exit(2)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(records, f, indent=2, ensure_ascii=False)
        f.write("\n")
    summary = {
        "status": "OK", "output": a.out, "build_date": today.isoformat(), "records": len(records),
        "published": sum(r["published"] for r in records),
        "future_dated_fixed": sum(1 for r in records if not r["recurring"] and not r["published"] and not r["is_tbd"]),
        "projected": sum(r["recurring"] for r in records),
        "projected_confirmed": sum(1 for r in records if r["recurring"] and r["date_confidence"] == "Confirmed"),
        "tbd_panel": sum(r["is_tbd"] for r in records),
        "overdue_planned": sum(1 for r in records if r.get("overdue")),
        "checks_error": sum(c["level"] == "error" for c in checks),
        "checks_review": sum(c["level"] == "review" for c in checks),
        "checks_tbd": sum(c["level"] == "tbd" for c in checks),
        "checks_warning": sum(c["level"] == "warning" for c in checks),
    }
    if a.events:
        summary["events"] = build_events(a.xlsx, a.events, checks)
    if a.report:
        with open(a.report, "w", encoding="utf-8") as f:
            json.dump({"summary": summary, "checks": checks}, f, indent=2, ensure_ascii=False)
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Generate data/holidays.json for the APAC Publication Calendar.

Single source: the `holidays` Python library (national/country-level only,
no subdivisions), English names. This mirrors exactly what the GitHub
Action runs on a 6-month schedule, so seed == production output.

Output shape:
{
  "generated_at": ISO,
  "source": "...",
  "years": [Y, Y+1],
  "markets": { "HK": [ {"date":"YYYY-MM-DD","name":"..."}, ... ], ... }
}
"""
import json, datetime, sys, os
import holidays

# ISO code -> display name. National scope (no subdiv) keeps it to public
# nationwide holidays only, per requirement.
MARKETS = {
    "HK": "Hong Kong", "AU": "Australia", "CN": "China", "KR": "South Korea",
    "JP": "Japan", "IN": "India", "ID": "Indonesia", "MY": "Malaysia",
    "PK": "Pakistan", "SG": "Singapore", "TW": "Taiwan", "TH": "Thailand",
    "VN": "Vietnam", "PH": "Philippines",
}
LANG = "en_US"   # English names where the library provides translations


def market_holidays(code, years):
    """Return de-duped, sorted national holidays for one market."""
    try:
        h = holidays.country_holidays(code, years=years, language=LANG)
    except Exception as e:
        print(f"  ! {code}: {e}", file=sys.stderr)
        return []
    rows = {}
    for d, name in h.items():
        iso = d.isoformat()
        # if two holidays land on one day, join their names
        if iso in rows and name not in rows[iso]:
            rows[iso] = f"{rows[iso]}; {name}"
        else:
            rows.setdefault(iso, name)
    return [{"date": k, "name": v} for k, v in sorted(rows.items())]


def main():
    this_year = datetime.date.today().year
    years = [this_year, this_year + 1]
    out = {
        "generated_at": datetime.datetime.now(datetime.UTC).isoformat(),
        "source": "Python `holidays` library — national (country-level) public holidays, English names",
        "years": years,
        "markets": {},
    }
    total = 0
    for code, name in MARKETS.items():
        rows = market_holidays(code, years)
        out["markets"][code] = rows
        total += len(rows)
        print(f"  {code} ({name}): {len(rows)} national holidays")
    # Resolve repo root from this file's location so it works locally and in CI.
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.dirname(here)
    path = os.environ.get("HOLIDAYS_OUT", os.path.join(repo_root, "data", "holidays.json"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"Wrote {total} holidays across {len(out['markets'])} markets for years {years} -> {path}")


if __name__ == "__main__":
    main()

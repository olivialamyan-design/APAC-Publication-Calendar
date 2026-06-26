/* =============================================================================
 * config.js — EDIT THIS FILE to point the app at your team's GitHub repo.
 * The whole GitHub-backed write workflow keys off these four constants.
 * Everything else (data file path, branch) is derived from here.
 * =========================================================================== */

window.APP_CONFIG = {
  // ---- GitHub repository that hosts /data/publications.json ----
  // Example for a repo published at https://acme.github.io/apac-pubcal/
  GITHUB_OWNER:  "olivialamyan-design", // <-- e.g. "savills-apac"
  GITHUB_REPO:   "APAC-Publication-Calendar", // <-- repository name
  GITHUB_BRANCH: "main",              // <-- branch GitHub Pages serves from
  DATA_PATH:     "data/publications.json", // path within the repo

  // ---- Static data files (relative to index.html) ----
  PUBLICATIONS_URL: "data/publications.json",
  MARKETS_URL:      "data/markets.json",
  SCHEMA_URL:       "data/schema.json",

  // ---- Default landing state ----
  // 2026-06-18: default scope -> Both, default window -> All (per request D).
  DEFAULT_SCOPE: "Both",            // Regional | In-Country | Both
  DEFAULT_RANGE: "all",            // all | history | forward12

  // ---- Taxonomies ----
  // NOTE (2026-06-18): These lists are now ORDERING HINTS / FALLBACKS only.
  // The filter bar derives its actual options dynamically from the loaded
  // publications.json (see DataLayer.distinctAssetClasses / distinctPubTypes /
  // distinctLanguages). The form + validation still reference these as the
  // canonical vocabulary. Values found in data that aren't listed here are
  // appended after the known ones (alphabetically) so the filter never goes
  // stale relative to the master spreadsheet.
  ASSET_CLASSES: [
    "All", "Office", "Retail", "Industrial & Logistics", "Residential",
    "Hospitality", "Data Centres", "Capital Markets", "Living", "Mixed Use"
  ],
  PUBLICATION_TYPES: [
    "Market Reports", "Newsletter", "Quarterly Outlooks", "Sector Updates",
    "Thought Leadership", "White Papers", "Blogs"
  ],
  LANGUAGES: [
    "English", "Chinese (Simplified)", "Chinese (Traditional)", "Japanese",
    "Korean", "Thai", "Vietnamese", "Bahasa Indonesia", "Bahasa Malaysia"
  ],
  REPORT_SCOPES: ["Regional", "In-Country"],

  // ---- FUTURE: Status taxonomy (NOT used in v1 UI). ----
  // When you wire the Status filter/badge later, this is the canonical list.
  // See docs/MAINTENANCE.md -> "Introducing the Status field".
  STATUS_VALUES: ["idea", "drafting", "review", "sign off", "published", "delayed"]
};

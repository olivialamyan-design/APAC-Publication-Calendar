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
  DEFAULT_SCOPE: "Regional",        // Regional | In-Country | Both
  DEFAULT_RANGE: "forward12",       // all | history | forward12

  // ---- Taxonomies (kept here so the form + filters share one source) ----
  ASSET_CLASSES: [
    "Office", "Logistics", "Residential", "Retail", "Hotels",
    "Industrial", "Capital Markets", "Data Centres", "Mixed Use"
  ],
  PUBLICATION_TYPES: [
    "Market Reports", "Blogs", "White Papers",
    "Thought Leadership", "Quarterly Outlooks", "Sector Updates"
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

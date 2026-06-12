/* =============================================================================
 * data.js — DATA LAYER
 * Responsible for: loading, parsing, validating, and writing the canonical
 * /data/publications.json. The GitHub Contents API write workflow lives here.
 * No DOM here. Views never touch GitHub directly — they call DataLayer.*.
 * =========================================================================== */

const DataLayer = (() => {
  let _publications = [];   // in-memory dataset (source of truth at runtime)
  let _markets = [];        // from markets.json
  let _marketIndex = {};    // name -> {fill, text}
  let _schema = null;

  // ---- generate a RFC4122-ish UUID without external deps ----
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ---- load all static data on startup ----
  async function loadAll() {
    const cfg = window.APP_CONFIG;
    const [pubs, mkts, schema] = await Promise.all([
      fetch(cfg.PUBLICATIONS_URL, { cache: "no-store" }).then(r => r.json()),
      fetch(cfg.MARKETS_URL, { cache: "no-store" }).then(r => r.json()),
      fetch(cfg.SCHEMA_URL, { cache: "no-store" }).then(r => r.json()).catch(() => null)
    ]);
    _publications = Array.isArray(pubs) ? pubs.map(normalize) : [];
    _markets = mkts.markets || [];
    _marketIndex = {};
    _markets.forEach(m => { _marketIndex[m.name] = m; });
    _schema = schema;
    return { publications: _publications, markets: _markets };
  }

  // ---- tolerate missing/null fields (esp. status, notes, city_state) ----
  function normalize(r) {
    return {
      id: r.id || uuid(),
      country: r.country || "",
      city_state: r.city_state || "",
      publication_name: r.publication_name || "",
      asset_class: Array.isArray(r.asset_class) ? r.asset_class : [],
      publication_type: r.publication_type || "",
      language: r.language || "",
      expected_publication_date: r.expected_publication_date || "",
      team: r.team || "",
      notes: r.notes || "",
      report_scope: r.report_scope || "Regional",
      // FUTURE-EXTENSIBLE: status is nullable in v1; UI must tolerate null/missing.
      status: (r.status === undefined ? null : r.status)
    };
  }

  // ---- client-side validation against the core required fields ----
  function validate(rec) {
    const errs = [];
    const cfg = window.APP_CONFIG;
    if (!rec.publication_name || !rec.publication_name.trim())
      errs.push("Publication name is required.");
    if (!rec.country) errs.push("Market is required.");
    if (!rec.publication_type) errs.push("Publication type is required.");
    if (!rec.language) errs.push("Language is required.");
    if (!rec.expected_publication_date) errs.push("Expected publication date is required.");
    if (!rec.report_scope) errs.push("Report scope is required.");
    if (rec.expected_publication_date &&
        !/^\d{4}-\d{2}-\d{2}$/.test(rec.expected_publication_date))
      errs.push("Date must be in YYYY-MM-DD format.");
    if (rec.publication_type && !cfg.PUBLICATION_TYPES.includes(rec.publication_type))
      errs.push("Unknown publication type.");
    if (rec.language && !cfg.LANGUAGES.includes(rec.language))
      errs.push("Unknown language.");
    (rec.asset_class || []).forEach(a => {
      if (!cfg.ASSET_CLASSES.includes(a)) errs.push("Unknown asset class: " + a);
    });
    return errs;
  }

  // ---- accessors ----
  const getAll = () => _publications.slice();
  const getMarkets = () => _markets.slice();
  const getMarket = name => _marketIndex[name] || { fill: "#79828C", text: "#FFFFFF" };
  const getById = id => _publications.find(p => p.id === id) || null;
  const getSchema = () => _schema;

  // ---- in-memory add (used after a successful GitHub write OR offline) ----
  function addLocal(rec) {
    const full = normalize(Object.assign({ id: uuid() }, rec));
    _publications.push(full);
    return full;
  }
  function replaceAll(arr) { _publications = arr.map(normalize); }

  // ===========================================================================
  // GitHub-backed write workflow (Contents API)
  // ---------------------------------------------------------------------------
  // Strategy:
  //   1. GET current file -> {sha, content (base64)}.  Avoids stale writes.
  //   2. Append the new record, re-encode base64, PUT with prior sha.
  //   3. On 409 (sha mismatch) re-fetch + re-apply + retry ONCE.
  //   4. Refresh in-memory dataset from what we committed.
  // Token is passed in per call and held in-memory only (see app.js). Never
  // persisted to localStorage/sessionStorage.
  // ===========================================================================

  function apiBase() {
    const c = window.APP_CONFIG;
    return `https://api.github.com/repos/${c.GITHUB_OWNER}/${c.GITHUB_REPO}/contents/${c.DATA_PATH}`;
  }

  // UTF-8 safe base64 helpers
  function b64encode(str) {
    return btoa(unescape(encodeURIComponent(str)));
  }
  function b64decode(b64) {
    return decodeURIComponent(escape(atob(b64.replace(/\n/g, ""))));
  }

  async function ghGetFile(token) {
    const c = window.APP_CONFIG;
    const res = await fetch(`${apiBase()}?ref=${c.GITHUB_BRANCH}`, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (res.status === 401) throw new Error("GitHub rejected the token (401). Check the PAT and its repo scope.");
    if (res.status === 404) throw new Error("Data file not found in the configured repo. Check js/config.js (owner/repo/branch/path).");
    if (!res.ok) throw new Error(`GitHub GET failed (${res.status}).`);
    const json = await res.json();
    return { sha: json.sha, records: JSON.parse(b64decode(json.content)) };
  }

  async function ghPutFile(token, records, sha, message, committer) {
    const body = {
      message,
      content: b64encode(JSON.stringify(records, null, 2) + "\n"),
      sha,
      branch: window.APP_CONFIG.GITHUB_BRANCH
    };
    if (committer && committer.name && committer.email) {
      body.committer = { name: committer.name, email: committer.email };
    }
    const res = await fetch(apiBase(), {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    return res;
  }

  /**
   * Commit a new publication record to GitHub.
   * @returns {Promise<{record, committed:number}>}
   */
  async function commitNewPublication(rec, token, committer) {
    const newRec = normalize(Object.assign({ id: uuid() }, rec));
    const errs = validate(newRec);
    if (errs.length) throw new Error("Validation failed:\n" + errs.join("\n"));

    const msg = `Add publication: ${newRec.publication_name} [${newRec.country}]`;

    // attempt with up to one conflict retry
    for (let attempt = 0; attempt < 2; attempt++) {
      const { sha, records } = await ghGetFile(token);
      const next = records.concat([newRec]);
      const res = await ghPutFile(token, next, sha, msg, committer);

      if (res.ok) {
        replaceAll(next);           // refresh in-memory dataset
        return { record: newRec, committed: next.length };
      }
      if (res.status === 409 && attempt === 0) {
        continue;                   // sha moved; re-fetch and retry once
      }
      if (res.status === 409) {
        throw new Error("The data file changed while you were editing — please re-submit.");
      }
      const detail = await res.json().catch(() => ({}));
      throw new Error(`GitHub write failed (${res.status}): ${detail.message || "unknown error"}`);
    }
  }

  // ---- Download fallback: produce a publications.json blob with rec appended ----
  function buildDownloadBlob(extraRec) {
    let arr = _publications.slice();
    if (extraRec) arr = arr.concat([normalize(Object.assign({ id: uuid() }, extraRec))]);
    return new Blob([JSON.stringify(arr, null, 2) + "\n"], { type: "application/json" });
  }

  return {
    loadAll, validate, uuid,
    getAll, getMarkets, getMarket, getById, getSchema,
    addLocal, replaceAll,
    commitNewPublication, buildDownloadBlob
  };
})();

/* =============================================================================
 * views/form.js — ADD / EDIT PUBLICATION FORM (right-hand slide-in panel)
 * Validates client-side against the schema (via DataLayer.validate).
 * Two save paths:
 *   1. Commit to GitHub via PAT (DataLayer.commitNewPublication) — canonical.
 *   2. Download JSON fallback (DataLayer.buildDownloadBlob) — no PAT needed.
 * The PAT is captured here and held in-memory ONLY (passed to DataLayer per
 * call; never stored). See README + docs/MAINTENANCE.md.
 * =========================================================================== */
const Form = (() => {
  let panel, overlay, editing = null;

  function ensure() {
    if (panel) return;
    overlay = H.el("div", { class: "panel-overlay", id: "formOverlay" });
    overlay.addEventListener("click", close);
    panel = H.el("aside", { class: "side-panel side-panel-wide", id: "formPanel",
      role: "dialog", "aria-label": "Add publication" });
    document.body.append(overlay, panel);
  }

  function opt(v, sel) { return `<option value="${H.esc(v)}"${v===sel?" selected":""}>${H.esc(v)}</option>`; }

  function checkboxRow(name, options, selected) {
    return options.map(o => `
      <label class="cbx"><input type="checkbox" name="${name}" value="${H.esc(o)}"
        ${selected.includes(o)?"checked":""}> ${H.esc(o)}</label>`).join("");
  }

  function open(rec) {
    ensure();
    editing = rec || null;
    const cfg = window.APP_CONFIG;
    const p = rec || { country:"", city_state:"", publication_name:"", asset_class:[],
      publication_type:"", language:"English", expected_publication_date:"",
      team:"", notes:"", report_scope:"Regional", status:null };

    panel.innerHTML = `
      <div class="dp-top">
        <h2 class="dp-title">${editing ? "Edit publication" : "Add publication"}</h2>
        <button class="btn-icon dp-close" title="Close">✕</button>
      </div>
      <form id="pubForm" class="frm">
        <label class="frm-l">Publication name *
          <input name="publication_name" value="${H.esc(p.publication_name)}" required>
        </label>
        <div class="frm-2">
          <label class="frm-l">Market *
            <select name="country" required>
              <option value="">Select market…</option>
              ${DataLayer.getMarkets().map(m => opt(m.name, p.country)).join("")}
            </select>
          </label>
          <label class="frm-l">City / State
            <input name="city_state" value="${H.esc(p.city_state)}">
          </label>
        </div>
        <div class="frm-2">
          <label class="frm-l">Publication type *
            <select name="publication_type" required>
              <option value="">Select type…</option>
              ${cfg.PUBLICATION_TYPES.map(t => opt(t, p.publication_type)).join("")}
            </select>
          </label>
          <label class="frm-l">Language *
            <select name="language" required>
              ${cfg.LANGUAGES.map(l => opt(l, p.language)).join("")}
            </select>
          </label>
        </div>
        <div class="frm-2">
          <label class="frm-l">Expected publication date *
            <input type="date" name="expected_publication_date" value="${H.esc(p.expected_publication_date)}" required>
          </label>
          <label class="frm-l">Report scope *
            <select name="report_scope" required>
              ${cfg.REPORT_SCOPES.map(s => opt(s, p.report_scope)).join("")}
            </select>
          </label>
        </div>
        <label class="frm-l">Team
          <input name="team" value="${H.esc(p.team)}" placeholder="e.g. HK Research">
        </label>
        <fieldset class="frm-fs">
          <legend>Asset class (multi-select)</legend>
          <div class="cbx-grid">${checkboxRow("asset_class", cfg.ASSET_CLASSES, p.asset_class)}</div>
        </fieldset>
        <label class="frm-l">Notes
          <textarea name="notes" rows="3">${H.esc(p.notes)}</textarea>
        </label>

        <!-- FUTURE STATUS FIELD INPUT GOES HERE (select from cfg.STATUS_VALUES).
             Keep nullable. See docs/MAINTENANCE.md. -->

        <div class="frm-err" id="frmErr" hidden></div>

        <div class="frm-divider">Save to GitHub (canonical)</div>
        <div class="frm-2">
          <label class="frm-l">Your name (commit author)
            <input name="committer_name" placeholder="Jane Doe">
          </label>
          <label class="frm-l">Your email
            <input name="committer_email" type="email" placeholder="jane@savills.com">
          </label>
        </div>
        <label class="frm-l">GitHub Personal Access Token
          <input name="pat" type="password" autocomplete="off"
            placeholder="github_pat_… (held in memory only, never stored)">
          <span class="frm-hint">Fine-grained PAT scoped to the repo with <code>contents: read &amp; write</code>. See README.</span>
        </label>

        <div class="frm-actions">
          <button type="submit" class="btn-primary" id="frmCommit">Commit to GitHub</button>
          <button type="button" class="btn-ghost" id="frmDownload">Download JSON instead</button>
          <button type="button" class="btn-ghost" id="frmCancel">Cancel</button>
        </div>
        <div class="frm-status" id="frmStatus" hidden></div>
      </form>`;

    panel.querySelector(".dp-close").addEventListener("click", close);
    panel.querySelector("#frmCancel").addEventListener("click", close);
    panel.querySelector("#frmDownload").addEventListener("click", onDownload);
    panel.querySelector("#pubForm").addEventListener("submit", onCommit);

    requestAnimationFrame(() => { overlay.classList.add("show"); panel.classList.add("show"); });
  }

  function readForm() {
    const f = panel.querySelector("#pubForm");
    const assets = Array.from(f.querySelectorAll('input[name="asset_class"]:checked'))
      .map(i => i.value);
    return {
      rec: {
        country: f.country.value,
        city_state: f.city_state.value.trim(),
        publication_name: f.publication_name.value.trim(),
        asset_class: assets,
        publication_type: f.publication_type.value,
        language: f.language.value,
        expected_publication_date: f.expected_publication_date.value,
        team: f.team.value.trim(),
        notes: f.notes.value.trim(),
        report_scope: f.report_scope.value,
        status: editing ? (editing.status ?? null) : null
      },
      pat: f.pat.value.trim(),
      committer: { name: f.committer_name.value.trim(), email: f.committer_email.value.trim() }
    };
  }

  function showErr(msg) {
    const e = panel.querySelector("#frmErr");
    e.textContent = msg; e.hidden = !msg;
  }
  function showStatus(msg, kind) {
    const s = panel.querySelector("#frmStatus");
    s.textContent = msg; s.hidden = !msg;
    s.className = "frm-status" + (kind ? " " + kind : "");
  }

  function validateOrShow(rec) {
    const errs = DataLayer.validate(rec);
    if (errs.length) { showErr(errs.join(" ")); return false; }
    showErr(""); return true;
  }

  async function onCommit(e) {
    e.preventDefault();
    const { rec, pat, committer } = readForm();
    if (!validateOrShow(rec)) return;
    if (!pat) { showErr("A GitHub token is required to commit. Or use 'Download JSON instead'."); return; }
    const btn = panel.querySelector("#frmCommit");
    btn.disabled = true; showStatus("Committing to GitHub…", "");
    try {
      const out = await DataLayer.commitNewPublication(rec, pat, committer);
      showStatus(`Committed. Dataset now has ${out.committed} publications.`, "ok");
      App.refreshFromData();
      App.toast("Publication committed to GitHub");
      setTimeout(close, 1200);
    } catch (err) {
      showStatus(err.message || String(err), "bad");
    } finally {
      btn.disabled = false;
    }
  }

  function onDownload() {
    const { rec } = readForm();
    if (!validateOrShow(rec)) return;
    const blob = DataLayer.buildDownloadBlob(rec);
    const url = URL.createObjectURL(blob);
    const a = H.el("a", { href: url, download: "publications.json" });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showStatus("Downloaded publications.json with your record appended. Commit it to the repo to publish.", "ok");
  }

  function close() {
    if (!panel) return;
    overlay.classList.remove("show");
    panel.classList.remove("show");
  }

  return { open, close };
})();

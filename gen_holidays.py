/* =============================================================================
 * views/detail.js — DETAIL SIDE PANEL (right-hand slide-in, NOT a modal)
 * Shows every field on the v2 master schema. Edit affordance (opens the Form).
 * Copy as Markdown.
 * Updated 2026-06-15:
 *   - Uses scope-based colour (DataLayer.colourFor) instead of per-market
 *   - Shows frequency, recurring months, recurring/parent badge, TBD flag
 *   - Shows series link when this is a recurring instance
 * =========================================================================== */
const Detail = (() => {
  let panel, overlay;

  function ensure() {
    if (panel) return;
    overlay = H.el("div", { class: "panel-overlay", id: "detailOverlay" });
    overlay.addEventListener("click", close);
    panel = H.el("aside", { class: "side-panel", id: "detailPanel",
      role: "dialog", "aria-label": "Publication detail" });
    document.body.append(overlay, panel);
  }

  function field(label, valHtml) {
    return `<div class="dp-field"><div class="dp-label">${H.esc(label)}</div>
      <div class="dp-value">${valHtml}</div></div>`;
  }

  // Format an array of recurring months [3,6,9,12] -> "Mar, Jun, Sep, Dec"
  function fmtMonths(arr) {
    if (!Array.isArray(arr) || !arr.length) return "—";
    return arr.slice().sort((a, b) => a - b)
      .map(m => H.MONTHS_SHORT[m - 1] || String(m)).join(", ");
  }

  function open(id) {
    const p = (typeof id === "object" && id) ? id : DataLayer.getById(id);
    if (!p) return;
    ensure();
    const c = DataLayer.colourFor(p);
    const assets = p.asset_class.length
      ? p.asset_class.map(a => `<span class="badge">${H.esc(a)}</span>`).join("")
      : "—";

    // Frequency badge
    const freqBadge = p.frequency
      ? `<span class="badge badge-freq">${H.esc(p.frequency)}</span>`
      : "—";

    // Recurring badge — yes/no
    const recBadge = p.recurring
      ? `<span class="badge badge-rec">↻ Recurring instance</span>`
      : (p.frequency && p.frequency !== "Ad Hoc"
          ? `<span class="badge">Series rule</span>`
          : `<span class="badge">One-off</span>`);

    // Series link — recurring instances point back to their parent (if present)
    const seriesRow = p.parent_id
      ? field("Series", `<span class="dp-series-id">${H.esc(p.parent_id)}</span>`)
      : "";

    // Recurring months — only meaningful for recurring/series rows
    const recMonthsRow = (p.frequency && p.frequency !== "Ad Hoc")
      ? field("Recurring months", H.esc(fmtMonths(p.recurring_months)))
      : "";

    // TBD banner — only for TBD rows
    const tbdBanner = p.is_tbd
      ? `<div class="dp-tbd-banner">No publication date set yet — this row is in the TBD queue. Click Edit to set a date.</div>`
      : "";

    // FUTURE STATUS BADGE would render here (tolerant of null).
    const statusRow = (p.status)
      ? field("Status", `<span class="badge">${H.esc(p.status)}</span>`)
      : "";

    panel.innerHTML = `
      <div class="dp-top">
        <span class="chip mkt-chip" style="background:${c.fill};color:${c.text}">${H.esc(p.country)}</span>
        ${p.recurring ? `<span class="chip dp-chip-rec" title="Recurring instance">↻</span>` : ""}
        <button class="btn-icon dp-close" title="Close">✕</button>
      </div>
      <h2 class="dp-title">${H.esc(p.publication_name)}</h2>
      ${tbdBanner}
      <div class="dp-body">
        ${field("Expected publication", `<span class="tnum">${p.expected_publication_date ? H.fmtLong(p.expected_publication_date) : '<em class="dp-muted">TBD</em>'}</span>`)}
        ${field("Country", H.esc(p.country) || "—")}
        ${field("City / State", H.esc(p.city_state) || "—")}
        ${field("Asset class", assets)}
        ${field("Publication type", H.esc(p.publication_type) || "—")}
        ${field("Language", H.esc(p.language) || "—")}
        ${field("Team", H.esc(p.team) || "—")}
        ${p.lead_author ? field("Lead author", H.esc(p.lead_author)) : ""}
        ${field("Report scope", `<span class="scope-tag scope-${p.report_scope==="Regional"?"reg":"loc"}">${H.esc(p.report_scope)}</span>`)}
        ${field("Frequency", freqBadge)}
        ${recMonthsRow}
        ${field("Recurring", recBadge)}
        ${seriesRow}
        ${statusRow}
        ${field("Notes", p.notes ? H.esc(p.notes) : "—")}
        <div class="dp-id">ID: ${H.esc(p.id)}</div>
      </div>
      <div class="dp-actions">
        <button class="btn-primary" id="dpEdit">Edit</button>
        <button class="btn-ghost" id="dpCopy">Copy as Markdown</button>
      </div>`;

    panel.querySelector(".dp-close").addEventListener("click", close);
    panel.querySelector("#dpEdit").addEventListener("click", () => { close(); Form.open(p); });
    panel.querySelector("#dpCopy").addEventListener("click", () => copyMarkdown(p));

    requestAnimationFrame(() => { overlay.classList.add("show"); panel.classList.add("show"); });
  }

  // a small list popover when a day has > visible events
  function openList(list, iso) {
    ensure();
    const items = list.map(p => {
      const c = DataLayer.colourFor(p);
      return `<button class="dp-listitem" data-id="${p.id}">
        <span class="mkt-dot" style="background:${c.fill}"></span>
        ${p.recurring ? '<span class="dp-list-rec" title="Recurring">↻</span> ' : ''}
        ${H.esc(p.publication_name)} <em>${H.esc(p.country)}</em></button>`;
    }).join("");
    panel.innerHTML = `
      <div class="dp-top">
        <span class="chip" style="background:var(--cream);color:#25273A;">${H.fmtLong(iso)}</span>
        <button class="btn-icon dp-close" title="Close">✕</button>
      </div>
      <h2 class="dp-title">${list.length} publications</h2>
      <div class="dp-body dp-list">${items}</div>`;
    panel.querySelector(".dp-close").addEventListener("click", close);
    panel.querySelectorAll(".dp-listitem").forEach(b =>
      b.addEventListener("click", () => open(b.getAttribute("data-id"))));
    requestAnimationFrame(() => { overlay.classList.add("show"); panel.classList.add("show"); });
  }

  function toMarkdown(p) {
    return [
      `**${p.publication_name}**`,
      ``,
      `- **Market:** ${p.country}${p.city_state ? " — " + p.city_state : ""}`,
      `- **Expected publication:** ${p.expected_publication_date ? H.fmtLong(p.expected_publication_date) : "TBD"}`,
      `- **Asset class:** ${p.asset_class.join(", ") || "—"}`,
      `- **Type:** ${p.publication_type}`,
      `- **Language:** ${p.language}`,
      `- **Team:** ${p.team || "—"}`,
      p.lead_author ? `- **Lead author:** ${p.lead_author}` : null,
      `- **Scope:** ${p.report_scope}`,
      `- **Frequency:** ${p.frequency || "Ad Hoc"}`,
      (p.frequency && p.frequency !== "Ad Hoc")
        ? `- **Recurring months:** ${fmtMonths(p.recurring_months)}` : null,
      p.recurring ? `- **Recurring instance:** yes` : null,
      p.notes ? `- **Notes:** ${p.notes}` : null
    ].filter(Boolean).join("\n");
  }

  function copyMarkdown(p) {
    const md = toMarkdown(p);
    const done = () => App.toast("Copied as Markdown");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(md).then(done).catch(() => fallbackCopy(md, done));
    } else fallbackCopy(md, done);
  }
  function fallbackCopy(text, cb) {
    const ta = H.el("textarea"); ta.value = text; document.body.appendChild(ta);
    ta.select(); try { document.execCommand("copy"); } catch (e) {}
    document.body.removeChild(ta); cb && cb();
  }

  function close() {
    if (!panel) return;
    overlay.classList.remove("show");
    panel.classList.remove("show");
  }

  return { open, openList, close };
})();

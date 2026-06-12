/* =============================================================================
 * views/detail.js — DETAIL SIDE PANEL (right-hand slide-in, NOT a modal)
 * Shows all fields. Edit affordance (opens the Form). Copy as Markdown.
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

  function open(id) {
    const p = DataLayer.getById(id);
    if (!p) return;
    ensure();
    const m = DataLayer.getMarket(p.country);
    const assets = p.asset_class.length
      ? p.asset_class.map(a => `<span class="badge">${H.esc(a)}</span>`).join("")
      : "—";

    // FUTURE STATUS BADGE would render here (tolerant of null).
    const statusRow = (p.status)
      ? field("Status", `<span class="badge">${H.esc(p.status)}</span>`)
      : "";

    panel.innerHTML = `
      <div class="dp-top">
        <span class="chip mkt-chip" style="background:${m.fill};color:${m.text}">${H.esc(p.country)}</span>
        <button class="btn-icon dp-close" title="Close">✕</button>
      </div>
      <h2 class="dp-title">${H.esc(p.publication_name)}</h2>
      <div class="dp-body">
        ${field("Expected publication", `<span class="tnum">${H.fmtLong(p.expected_publication_date)}</span>`)}
        ${field("City / State", H.esc(p.city_state) || "—")}
        ${field("Asset class", assets)}
        ${field("Publication type", H.esc(p.publication_type) || "—")}
        ${field("Language", H.esc(p.language) || "—")}
        ${field("Team", H.esc(p.team) || "—")}
        ${field("Report scope", `<span class="scope-tag scope-${p.report_scope==="Regional"?"reg":"loc"}">${H.esc(p.report_scope)}</span>`)}
        ${statusRow}
        ${field("Notes", H.esc(p.notes) || "—")}
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
      const m = DataLayer.getMarket(p.country);
      return `<button class="dp-listitem" data-id="${p.id}">
        <span class="mkt-dot" style="background:${m.fill}"></span>
        ${H.esc(p.publication_name)} <em>${H.esc(p.country)}</em></button>`;
    }).join("");
    panel.innerHTML = `
      <div class="dp-top">
        <span class="chip" style="background:var(--cream)">${H.fmtLong(iso)}</span>
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
      `- **Expected publication:** ${H.fmtLong(p.expected_publication_date)}`,
      `- **Asset class:** ${p.asset_class.join(", ") || "—"}`,
      `- **Type:** ${p.publication_type}`,
      `- **Language:** ${p.language}`,
      `- **Team:** ${p.team || "—"}`,
      `- **Scope:** ${p.report_scope}`,
      p.notes ? `- **Notes:** ${p.notes}` : ``
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

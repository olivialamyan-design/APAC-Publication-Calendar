/* =============================================================================
 * helpers.js — shared view utilities (DOM, dates, chips, escaping)
 * =========================================================================== */
const H = (() => {
  const MONTHS = ["January","February","March","April","May","June","July",
    "August","September","October","November","December"];
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const esc = s => String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");

  const el = (tag, attrs = {}, html = "") => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) n.setAttribute(k, v);
    });
    if (html) n.innerHTML = html;
    return n;
  };

  // parse ISO date as LOCAL (avoid UTC shift)
  const parseISO = iso => {
    const [y, m, d] = (iso || "").split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  };
  const fmtLong = iso => {
    if (!iso) return "—";
    const d = parseISO(iso);
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  };
  const isPast = iso => iso && iso < State.todayISO();

  // market chip element
  const marketChip = country => {
    const m = DataLayer.getMarket(country);
    return el("span", {
      class: "chip mkt-chip",
      style: `background:${m.fill};color:${m.text};`,
      title: country
    }, esc(country));
  };
  const marketDot = country => {
    const m = DataLayer.getMarket(country);
    return `<span class="mkt-dot" style="background:${m.fill}"></span>`;
  };

  // small badge (asset classes etc.)
  const badge = (txt, cls = "") => el("span", { class: "badge " + cls }, esc(txt));

  return { MONTHS, MONTHS_SHORT, esc, el, parseISO, fmtLong, isPast, marketChip, marketDot, badge };
})();

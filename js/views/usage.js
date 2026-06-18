/* =============================================================================
 * views/usage.js — USAGE TAB
 * Renders a daily page-open bar chart (inline SVG, no chart library) plus a
 * CSV export button. Reads the shared series from Usage (server snapshot +
 * this-device local tally). Honours light/dark theme via CSS variables.
 * =========================================================================== */
const UsageView = (() => {

  function render(mount) {
    mount.innerHTML = "";
    const wrap = H.el("div", { class: "usage-view" });

    // Header row: title + export
    const head = H.el("div", { class: "usage-head" });
    head.appendChild(H.el("h2", { class: "usage-title" }, "Platform usage"));
    const exportBtn = H.el("button", { class: "btn-ghost" }, "Export usage CSV");
    exportBtn.addEventListener("click", () => Usage.exportCsv());
    head.appendChild(exportBtn);
    wrap.appendChild(head);

    const sub = H.el("p", { class: "usage-sub" },
      "Number of times the platform was opened, per day. Visit counts only \u2014 no clickstream tracking.");
    wrap.appendChild(sub);

    mount.appendChild(wrap);

    // Load shared counts then paint. (Local tally is available immediately.)
    Usage.loadServer().then(() => paint(wrap)).catch(() => paint(wrap));
    // paint once immediately with whatever we have so the tab isn't blank
    paint(wrap);
  }

  function paint(wrap) {
    // remove any previously painted body
    wrap.querySelectorAll(".usage-body").forEach(n => n.remove());
    const body = H.el("div", { class: "usage-body" });

    const data = Usage.series();
    const m = Usage.meta();

    // KPI cards
    const totalServer = data.reduce((s, d) => s + (d.count || 0), 0);
    const totalLocal = data.reduce((s, d) => s + (d.local || 0), 0);
    const last30 = data.slice(-30);
    const kpis = H.el("div", { class: "usage-kpis" });
    kpis.appendChild(kpiCard("Total opens", fmt(totalServer || totalLocal), m.hasServer ? "shared across all users" : "this device only"));
    kpis.appendChild(kpiCard("Days tracked", fmt(data.length), m.updatedAt ? `updated ${m.updatedAt}` : "\u2014"));
    kpis.appendChild(kpiCard("Last 30 days", fmt(last30.reduce((s, d) => s + (d.count || d.local || 0), 0)), "rolling window"));
    body.appendChild(kpis);

    // Source note
    const note = H.el("div", { class: "usage-source" });
    if (m.hasServer) {
      note.innerHTML = `Source: <strong>${H.esc(m.source || "GitHub Pages views")}</strong>. ` +
        `Shared daily counts are produced by a scheduled GitHub Action that snapshots ` +
        `GitHub Pages' own view stats into <code>data/usage.json</code>. ` +
        `The faint overlay shows opens from this device.`;
    } else {
      note.innerHTML = `<strong>Showing this-device counts only.</strong> ` +
        `Shared cross-user counts appear once the usage-snapshot GitHub Action has run ` +
        `and committed <code>data/usage.json</code>. (GitHub Pages is static, so shared ` +
        `counts must come from that committed file \u2014 not browser storage.)`;
    }
    body.appendChild(note);

    // Chart
    if (!data.length) {
      body.appendChild(H.el("div", { class: "usage-empty" },
        "No usage recorded yet. Open the platform a few times \u2014 counts will appear here."));
    } else {
      body.appendChild(barChart(data.slice(-60))); // show up to last 60 days
    }

    wrap.appendChild(body);
  }

  function kpiCard(label, value, delta) {
    const c = H.el("div", { class: "usage-kpi" });
    c.innerHTML =
      `<div class="usage-kpi-val tnum">${H.esc(value)}</div>` +
      `<div class="usage-kpi-label">${H.esc(label)}</div>` +
      `<div class="usage-kpi-delta">${H.esc(delta)}</div>`;
    return c;
  }

  function fmt(n) { return (Number(n) || 0).toLocaleString(); }

  // ---- inline SVG bar chart (no library) ----
  function barChart(data) {
    const W = 980, H_ = 320, padL = 40, padR = 12, padT = 14, padB = 46;
    const innerW = W - padL - padR, innerH = H_ - padT - padB;
    const maxV = Math.max(1, ...data.map(d => Math.max(d.count || 0, d.local || 0)));
    const n = data.length;
    const gap = n > 40 ? 1 : 3;
    const bw = Math.max(2, (innerW - gap * (n - 1)) / n);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", `0 0 ${W} ${H_}`);
    svg.setAttribute("class", "usage-chart");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Daily platform opens");

    // gridlines + y labels (0, mid, max)
    [0, 0.5, 1].forEach(f => {
      const y = padT + innerH - innerH * f;
      const line = svgEl("line", { x1: padL, y1: y, x2: W - padR, y2: y, class: "usage-grid" });
      svg.appendChild(line);
      const lbl = svgEl("text", { x: padL - 6, y: y + 3, class: "usage-axis", "text-anchor": "end" });
      lbl.textContent = String(Math.round(maxV * f));
      svg.appendChild(lbl);
    });

    data.forEach((d, i) => {
      const x = padL + i * (bw + gap);
      const v = d.count || 0;
      const lv = d.local || 0;
      // shared (server) bar
      if (v > 0) {
        const h = innerH * (v / maxV);
        const bar = svgEl("rect", {
          x, y: padT + innerH - h, width: bw, height: h,
          rx: Math.min(2, bw / 3), class: "usage-bar"
        });
        const title = svgEl("title", {});
        title.textContent = `${d.date}: ${v} opens`;
        bar.appendChild(title);
        svg.appendChild(bar);
      }
      // local overlay (thin marker on top) — only when no server data or as ref
      if (lv > 0) {
        const h = innerH * (lv / maxV);
        const ov = svgEl("rect", {
          x: x + bw * 0.28, y: padT + innerH - h, width: Math.max(1.5, bw * 0.44),
          height: h, class: "usage-bar-local"
        });
        const t2 = svgEl("title", {});
        t2.textContent = `${d.date}: ${lv} (this device)`;
        ov.appendChild(t2);
        svg.appendChild(ov);
      }
      // x labels: show ~8 evenly spaced
      const step = Math.ceil(n / 8);
      if (i % step === 0 || i === n - 1) {
        const tx = svgEl("text", {
          x: x + bw / 2, y: H_ - padB + 16, class: "usage-axis", "text-anchor": "middle"
        });
        tx.textContent = shortDate(d.date);
        svg.appendChild(tx);
      }
    });

    const card = H.el("div", { class: "usage-chart-card" });
    card.appendChild(svg);
    // legend
    const lg = H.el("div", { class: "usage-chart-legend" });
    lg.innerHTML =
      `<span class="ucl"><span class="ucl-sw ucl-shared"></span> Shared opens (all users)</span>` +
      `<span class="ucl"><span class="ucl-sw ucl-local"></span> This device</span>`;
    card.appendChild(lg);
    return card;
  }

  function svgEl(tag, attrs) {
    const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    return e;
  }
  function shortDate(iso) {
    const [, m, d] = (iso || "").split("-");
    return m && d ? `${m}/${d}` : iso;
  }

  return { render };
})();

/* =============================================================================
 * views/usage.js — USAGE TAB (2026-07-08)
 * Renders a daily page-open bar chart (inline SVG, no chart library) plus a
 * Desktop vs Mobile device breakdown section.
 * Reads the shared series from Usage (server snapshot + this-device local tally).
 * Honours light/dark theme via CSS variables.
 * =========================================================================== */
const UsageView = (() => {

  function render(mount) {
    mount.innerHTML = "";
    const wrap = H.el("div", { class: "usage-view" });

    // Header row: title only (Export CSV removed)
    const head = H.el("div", { class: "usage-head" });
    head.appendChild(H.el("h2", { class: "usage-title" }, "Platform usage"));
    wrap.appendChild(head);

    const sub = H.el("p", { class: "usage-sub" },
      "Number of times the platform was opened, per day. Visit counts only \u2014 no clickstream tracking.");
    wrap.appendChild(sub);

    mount.appendChild(wrap);

    Usage.loadServer().then(() => paint(wrap)).catch(() => paint(wrap));
    paint(wrap);
  }

  function paint(wrap) {
    wrap.querySelectorAll(".usage-body").forEach(n => n.remove());
    const body = H.el("div", { class: "usage-body" });

    const data = Usage.series();
    const m = Usage.meta();

    // KPI cards
    const totalServer = data.reduce((s, d) => s + (d.count || 0), 0);
    const totalLocal  = data.reduce((s, d) => s + (d.local || 0), 0);
    const last30 = data.slice(-30);
    const kpis = H.el("div", { class: "usage-kpis" });
    kpis.appendChild(kpiCard("Total opens", fmt(totalServer || totalLocal),
      m.hasServer ? "shared across all users" : "this device only"));
    kpis.appendChild(kpiCard("Days tracked", fmt(data.length),
      m.updatedAt ? `updated ${m.updatedAt}` : "\u2014"));
    kpis.appendChild(kpiCard("Last 30 days",
      fmt(last30.reduce((s, d) => s + (d.count || d.local || 0), 0)), "rolling window"));
    body.appendChild(kpis);

    // Source note
    const note = H.el("div", { class: "usage-source" });
    if (m.hasServer) {
      note.innerHTML =
        `Source: <strong>${H.esc(m.source || "GitHub Pages views")}</strong>. ` +
        `Shared daily counts are produced by a scheduled GitHub Action that snapshots ` +
        `GitHub Pages' own view stats into <code>data/usage.json</code>. ` +
        `The faint overlay shows opens from this device.`;
    } else {
      note.innerHTML =
        `<strong>Showing this-device counts only.</strong> ` +
        `Shared cross-user counts appear once the usage-snapshot GitHub Action has run ` +
        `and committed <code>data/usage.json</code>.`;
    }
    body.appendChild(note);

    // Daily bar chart
    if (!data.length) {
      body.appendChild(H.el("div", { class: "usage-empty" },
        "No usage recorded yet. Open the platform a few times \u2014 counts will appear here."));
    } else {
      body.appendChild(barChart(data.slice(-60)));
    }

    // ---- Device breakdown section ----
    body.appendChild(deviceBreakdown());

    wrap.appendChild(body);
  }

  // ---- Device breakdown: Desktop vs Mobile ----
  function deviceBreakdown() {
    const section = H.el("div", { class: "usage-device-section" });
    section.appendChild(H.el("h3", { class: "usage-device-title" }, "Device breakdown"));
    section.appendChild(H.el("p", { class: "usage-device-sub" },
      "Detected from this browser only. Desktop includes all non-mobile browsers; Mobile includes phones and tablets."));

    const ds = Usage.deviceStats();
    const total = ds.desktop + ds.mobile;

    if (total === 0) {
      section.appendChild(H.el("div", { class: "usage-empty" },
        "No device data recorded on this browser yet."));
      return section;
    }

    const cards = H.el("div", { class: "usage-device-cards" });

    // Desktop card
    const deskPct = total > 0 ? Math.round((ds.desktop / total) * 100) : 0;
    const mobPct  = total > 0 ? Math.round((ds.mobile  / total) * 100) : 0;

    cards.appendChild(deviceCard(
      "\uD83D\uDCBB", "Desktop", ds.desktop, deskPct,
      ds.currentDevice === "desktop" ? "(this device)" : ""
    ));
    cards.appendChild(deviceCard(
      "\uD83D\uDCF1", "Mobile", ds.mobile, mobPct,
      ds.currentDevice === "mobile" ? "(this device)" : ""
    ));

    section.appendChild(cards);

    // Bar chart: stacked proportion bar
    if (total > 0) {
      const barWrap = H.el("div", { class: "usage-device-bar-wrap" });
      const bar = H.el("div", { class: "usage-device-bar" });
      if (deskPct > 0) {
        const deskSeg = H.el("div", { class: "usage-device-seg usage-device-seg-desktop",
          style: `width:${deskPct}%`, title: `Desktop: ${deskPct}%` });
        deskSeg.textContent = deskPct >= 10 ? `${deskPct}%` : "";
        bar.appendChild(deskSeg);
      }
      if (mobPct > 0) {
        const mobSeg = H.el("div", { class: "usage-device-seg usage-device-seg-mobile",
          style: `width:${mobPct}%`, title: `Mobile: ${mobPct}%` });
        mobSeg.textContent = mobPct >= 10 ? `${mobPct}%` : "";
        bar.appendChild(mobSeg);
      }
      barWrap.appendChild(bar);
      section.appendChild(barWrap);
    }

    return section;
  }

  function deviceCard(icon, label, count, pct, badge) {
    const c = H.el("div", { class: "usage-device-card" });
    c.innerHTML =
      `<div class="usage-device-icon">${icon}</div>` +
      `<div class="usage-device-val tnum">${fmt(count)}</div>` +
      `<div class="usage-device-label">${H.esc(label)}</div>` +
      `<div class="usage-device-pct">${pct}% of opens${badge ? ` <span class="usage-device-badge">${H.esc(badge)}</span>` : ""}</div>`;
    return c;
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

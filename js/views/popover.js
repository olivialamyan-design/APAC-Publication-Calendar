/* =============================================================================
 * views/popover.js — LIGHTWEIGHT ANCHORED POPOVERS (2026-10-29)
 *
 *   Popover.create(cls)   generic floating card anchored to an element.
 *                         Reuses the .ms-pop card styling (surface, hairline,
 *                         shadow) so it follows the light/dark theme tokens.
 *                         Closes on outside click (capture phase, so it still
 *                         closes when the click lands on a pill that stops
 *                         propagation), Esc, scroll and resize.
 *   EventPopover          Savills event card (single event or a day's list).
 *                         Used by the calendar pills/bars, the strip and the
 *                         Events tab. NOT the detail side panel.
 *   HolidayPopover        hover / focus / tap card for "+N more holidays".
 *
 * No storage is used; all state lives in these closures.
 * =========================================================================== */
const Popover = (() => {
  const instances = [];

  function create(cls) {
    let el = null, anchor = null, onHide = null;

    function ensure() {
      if (el) return;
      el = H.el("div", { class: `ms-pop app-pop ${cls || ""}`, role: "dialog" });
      // keep App's document click handler from treating inner clicks as outside
      el.addEventListener("click", e => e.stopPropagation());
      document.body.appendChild(el);
    }

    function position() {
      if (!el || !anchor) return;
      const r = anchor.getBoundingClientRect();
      const vw = document.documentElement.clientWidth, vh = window.innerHeight;
      const pw = el.offsetWidth, ph = el.offsetHeight, gap = 6, pad = 8;
      let left = Math.min(Math.max(pad, r.left), vw - pw - pad);
      let top = r.bottom + gap;
      if (top + ph > vh - pad && r.top - gap - ph >= pad) top = r.top - gap - ph;  // flip above
      top = Math.max(pad, Math.min(top, vh - ph - pad));
      el.style.left = `${Math.round(Math.max(pad, left))}px`;
      el.style.top  = `${Math.round(top)}px`;
    }

    function show(anchorEl, html, opts = {}) {
      ensure();
      if (anchor && anchor !== anchorEl) hide();
      anchor = anchorEl;
      onHide = opts.onHide || null;
      el.innerHTML = html;
      if (opts.label) el.setAttribute("aria-label", opts.label);
      el.classList.add("open");
      position();
      if (opts.onRender) opts.onRender(el);
      return el;
    }

    function hide() {
      if (!el || !el.classList.contains("open")) { anchor = null; return; }
      el.classList.remove("open");
      const cb = onHide; onHide = null;
      const a = anchor; anchor = null;
      if (cb) cb(a);
    }

    const api = {
      show, hide, position,
      isOpen: () => !!(el && el.classList.contains("open")),
      anchor: () => anchor,
      contains: node => !!(el && node && el.contains(node)),
      el: () => el
    };
    instances.push(api);
    return api;
  }

  function hideAll() { instances.forEach(p => p.hide()); }

  // ---- global dismissal ----
  document.addEventListener("click", e => {
    instances.forEach(p => {
      if (!p.isOpen()) return;
      const a = p.anchor();
      if (p.contains(e.target) || (a && a.contains(e.target))) return;
      p.hide();
    });
  }, true);
  document.addEventListener("keydown", e => {
    if (e.key !== "Escape") return;
    instances.forEach(p => {
      if (!p.isOpen()) return;
      const a = p.anchor();
      p.hide();
      if (a && a.focus && document.body.contains(a)) a.focus();
    });
  });
  window.addEventListener("resize", hideAll);
  window.addEventListener("scroll", e => {
    // ignore scrolls inside a popover itself (long lists)
    instances.forEach(p => { if (p.isOpen() && !p.contains(e.target)) p.hide(); });
  }, true);

  return { create, hideAll };
})();

/* -------------------------------------------------------------------------
 * EventPopover — Savills event card. Blank fields are hidden.
 * ----------------------------------------------------------------------- */
const EventPopover = (() => {
  const pop = Popover.create("sev-pop");

  function row(label, valHtml) {
    return `<div class="sev-pop-row"><div class="sev-pop-k">${H.esc(label)}</div>` +
           `<div class="sev-pop-v">${valHtml}</div></div>`;
  }

  function safeUrl(u) {
    return /^https?:\/\//i.test(u || "") ? u : null;
  }

  function cardHtml(ev) {
    const url = safeUrl(ev.link);
    const rows = [
      [ev.multi_day ? "Dates" : "Date", H.esc(SavillsEvents.fmtRange(ev))],
      ["Type", ev.event_type && H.esc(ev.event_type)],
      ["Market", ev.market && H.esc(ev.market)],
      ["Venue", ev.venue && H.esc(ev.venue)],
      ["Organiser", ev.organiser && H.esc(ev.organiser)],
      ["Audience", ev.audience && H.esc(ev.audience)],
      ["Link", url && `<a class="sev-pop-link" href="${H.esc(url)}" target="_blank" rel="noopener noreferrer">${H.esc(url.replace(/^https?:\/\//i, ""))} ↗</a>`],
      ["Notes", ev.notes && H.esc(ev.notes)]
    ].filter(([, v]) => v).map(([k, v]) => row(k, v)).join("");
    return `<div class="sev-pop-head">` +
             `<span class="sev-pop-tag">Savills event</span>` +
             `<button class="sev-pop-x" type="button" aria-label="Close">✕</button>` +
           `</div>` +
           `<div class="sev-pop-title">${H.esc(ev.name)}</div>` +
           `<div class="sev-pop-body">${rows}</div>`;
  }

  function wireClose(el) {
    const x = el.querySelector(".sev-pop-x");
    if (x) x.addEventListener("click", () => pop.hide());
  }

  function setExpanded(anchor, on) {
    if (anchor && anchor.setAttribute) anchor.setAttribute("aria-expanded", on ? "true" : "false");
  }

  function open(ev, anchor) {
    if (!ev || !anchor) return;
    if (pop.isOpen() && pop.anchor() === anchor && pop.el().dataset.evId === ev.id) { pop.hide(); return; }
    pop.show(anchor, cardHtml(ev), {
      label: ev.name,
      onRender: el => { el.dataset.evId = ev.id; wireClose(el); },
      onHide: a => setExpanded(a, false)
    });
    setExpanded(anchor, true);
  }

  // A day's full event list ("+N more events"). Picking one swaps to its card.
  function openList(events, iso, anchor) {
    if (!events || !events.length || !anchor) return;
    if (pop.isOpen() && pop.anchor() === anchor && pop.el().dataset.evId === `list:${iso}`) { pop.hide(); return; }
    const items = events.map((ev, i) =>
      `<button type="button" class="sev-pop-item" data-i="${i}">` +
        `<span class="sev-dot" aria-hidden="true"></span>` +
        `<span class="sev-pop-item-name">${H.esc(ev.name)}</span>` +
        `<span class="sev-pop-item-meta">${H.esc([ev.event_type, ev.venue].filter(Boolean).join(" · "))}</span>` +
      `</button>`).join("");
    const html =
      `<div class="sev-pop-head">` +
        `<span class="sev-pop-tag">${events.length} Savills event${events.length === 1 ? "" : "s"} · ${H.esc(H.fmtLong(iso))}</span>` +
        `<button class="sev-pop-x" type="button" aria-label="Close">✕</button>` +
      `</div>` +
      `<div class="sev-pop-list">${items}</div>`;
    pop.show(anchor, html, {
      label: `Savills events on ${H.fmtLong(iso)}`,
      onRender: el => {
        el.dataset.evId = `list:${iso}`;
        wireClose(el);
        el.querySelectorAll(".sev-pop-item").forEach(b => b.addEventListener("click", () => {
          const ev = events[Number(b.dataset.i)];
          pop.show(anchor, cardHtml(ev), {
            label: ev.name,
            onRender: e2 => { e2.dataset.evId = ev.id; wireClose(e2); },
            onHide: a => setExpanded(a, false)
          });
        }));
      },
      onHide: a => setExpanded(a, false)
    });
    setExpanded(anchor, true);
  }

  return { open, openList, close: () => pop.hide() };
})();
/* -------------------------------------------------------------------------
 * HolidayPopover — "+N more holidays" card. Mouse/pen: hover. Keyboard:
 * focus. Touch: tap toggles. Dismiss: pointer leave, blur, Esc, outside tap.
 * ----------------------------------------------------------------------- */
const HolidayPopover = (() => {
  const pop = Popover.create("hol-pop");
  let hideTimer = null;

  function html(iso, hols) {
    const lines = hols.map(h =>
      `<li>${H.esc(h.market)} – ${H.esc(h.name)}</li>`).join("");
    return `<div class="hol-pop-head">Public holidays · ${H.esc(H.fmtLong(iso))}</div>` +
           `<ul class="hol-pop-list">${lines}</ul>`;
  }

  function showFor(trigger, iso, hols) {
    clearTimeout(hideTimer);
    if (pop.isOpen() && pop.anchor() === trigger) return;
    pop.show(trigger, html(iso, hols), {
      label: `Public holidays on ${H.fmtLong(iso)}`,
      onRender: el => {
        el.onpointerenter = () => clearTimeout(hideTimer);
        el.onpointerleave = e => { if (e.pointerType !== "touch") scheduleHide(); };
      },
      onHide: a => a && a.setAttribute && a.setAttribute("aria-expanded", "false")
    });
    trigger.setAttribute("aria-expanded", "true");
  }

  function scheduleHide() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => pop.hide(), 120);
  }

  // Wire a "+N more holiday(s)" element. `hols` = ALL holidays for the day.
  function attach(trigger, iso, hols) {
    let lastPointer = "mouse", lastDown = 0;
    trigger.setAttribute("tabindex", "0");
    trigger.setAttribute("role", "button");
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("pointerdown", e => { lastPointer = e.pointerType || "mouse"; lastDown = Date.now(); });
    trigger.addEventListener("pointerenter", e => { if (e.pointerType !== "touch") showFor(trigger, iso, hols); });
    trigger.addEventListener("pointerleave", e => { if (e.pointerType !== "touch") scheduleHide(); });
    trigger.addEventListener("focus", () => {
      if (Date.now() - lastDown < 600) return;          // pointer path handles it
      showFor(trigger, iso, hols);
    });
    trigger.addEventListener("blur", () => {
      if (lastPointer === "touch") return;              // touch closes via outside tap
      scheduleHide();
    });
    trigger.addEventListener("click", e => {
      e.stopPropagation();
      if (lastPointer === "touch" && pop.isOpen() && pop.anchor() === trigger) pop.hide();
      else showFor(trigger, iso, hols);
    });
    trigger.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); showFor(trigger, iso, hols); }
    });
  }

  return { attach, close: () => pop.hide() };
})();

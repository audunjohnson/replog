/* app.js — Augie Swole UI. Vanilla JS, no framework, no build step. */
(() => {
  'use strict';

  const content = document.getElementById('content');
  const tabbar = document.getElementById('tabbar');
  let view = 'workout';

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const DAY_UI = {
    leg: { name: 'Leg Day', btn: 'alt', sub: '' },
    push: { name: 'Push Day', btn: '', sub: 'chest · shoulders · tricep' },
    pull: { name: 'Pull Day', btn: 'alt2', sub: 'back · bicep' },
  };
  const dayName = (d) => (DAY_UI[d] ? DAY_UI[d].name : d);
  const haptic = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  const unit = () => DB.getSettings().unit;
  const round = (n) => Math.round(n * 10) / 10;
  const pct = (n, d) => (d ? Math.min(100, Math.round((n / d) * 100)) : 0);
  // Bump increment: 2.5 below 25, 5 at/above 25.
  const weightStep = (w) => ((Number(w) || 0) < 25 ? 2.5 : 5);

  /* ---------------- chart point popup ---------------- */
  const chartTip = document.createElement('div');
  chartTip.id = 'chart-tip'; chartTip.hidden = true;
  document.body.appendChild(chartTip);
  function hideChartTip() { chartTip.hidden = true; }
  function showChartTip(dot) {
    chartTip.innerHTML = '';
    const v = document.createElement('div'); v.className = 'tip-val'; v.textContent = dot.dataset.v;
    const d = document.createElement('div'); d.className = 'tip-date'; d.textContent = dot.dataset.d;
    chartTip.append(v, d);
    chartTip.hidden = false;
    const r = dot.getBoundingClientRect();
    const tw = chartTip.offsetWidth, th = chartTip.offsetHeight;
    let left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
    let top = r.top - th - 8;
    if (top < 8) top = r.bottom + 8;
    chartTip.style.left = left + 'px';
    chartTip.style.top = top + 'px';
  }

  /* ---------------- in-app dialogs (native alert/confirm freeze iOS PWAs) ---------------- */
  function modal({ message, confirmText = 'OK', cancelText = null, danger = false, onConfirm = null }) {
    const ov = document.createElement('div');
    ov.className = 'overlay overlay-center';
    ov.innerHTML = `
      <div class="dialog">
        <div class="dialog-msg">${esc(message)}</div>
        <div class="dialog-btns">
          ${cancelText ? `<button class="ghost-btn" data-x="cancel">${esc(cancelText)}</button>` : ''}
          <button class="big-btn ${danger ? 'danger-btn' : ''}" data-x="ok">${esc(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => {
      if (ev.target !== ov && !ev.target.closest('[data-x]')) return;
      const ok = ev.target.closest && ev.target.closest('[data-x="ok"]');
      ov.remove();
      if (ok && onConfirm) onConfirm();
    });
  }
  const confirmDialog = (message, onConfirm, opts = {}) =>
    modal({ message, confirmText: opts.confirmText || 'Confirm', cancelText: opts.cancelText || 'Cancel', danger: opts.danger, onConfirm });
  const alertDialog = (message) => modal({ message });

  function fmtDate(iso) {
    const d = new Date(iso);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const that = new Date(d); that.setHours(0, 0, 0, 0);
    const days = Math.round((today - that) / 86400000);
    if (days === 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days > 1 && days < 7) return `${days} days ago`;
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const fmtDateTime = (iso) => new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const fmtAxis = (iso) => new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function lastAccText(exerciseId) {
    const last = DB.lastPerformance(exerciseId);
    if (!last) return '<span class="dim">No history yet</span>';
    return `Last · ${esc(fmtDate(last.date))}: ${esc(accSessionSummary(last.entry))}`;
  }

  // "120lb × 8, 8, 7" — or per-set weights when they varied ("120×8, 125×6 lb").
  function accSessionSummary(e) {
    const sets = DB.doneSets(e);
    if (!sets.length) return '';
    const reps = sets.map(s => s.reps).join(', ');
    if (e.bodyweight) return `${reps} reps`;
    if (sets.every(s => s.weight === sets[0].weight)) return `${sets[0].weight}${e.unit} × ${reps}`;
    return `${sets.map(s => `${s.weight}×${s.reps}`).join(', ')} ${e.unit}`;
  }

  /* ---------------- top-level render ---------------- */
  function render() {
    drag = null; // safety: any re-render (e.g. tab switch) clears a stuck drag
    hideChartTip();
    stopGalaxy(); // never leave the star loop running behind another view
    [...tabbar.children].forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    // Drop the tab bar's backdrop blur over the animating canvas: it re-evaluates in
    // the iOS compositor commit path every frame (the same hazard class that froze the
    // bonsai tab) and its hit-testing wedges when commits stall.
    tabbar.classList.toggle('galaxy-active', view === 'galaxy');
    // Safety net: if a view throws (e.g. malformed imported data), show what broke
    // instead of leaving stale DOM where every tap silently re-throws — which
    // looks exactly like a frozen app.
    try {
      if (view === 'workout') content.innerHTML = renderWorkout();
      if (view === 'stats') content.innerHTML = renderStats();
      if (view === 'galaxy') { content.innerHTML = renderGalaxy(); mountGalaxy(); }
      if (view === 'history') content.innerHTML = renderHistory();
      if (view === 'program') content.innerHTML = renderProgram();
      if (view === 'backup') content.innerHTML = renderBackup();
    } catch (err) {
      content.innerHTML = `
        <header class="hdr"><h1>Something went wrong</h1>
          <div class="hdr-sub">This tab hit an error — the other tabs still work.</div></header>
        <div class="card"><div class="dim small">${esc((err && err.message) || String(err))}</div></div>`;
    }
    content.scrollTop = 0;
    syncWakeLock(); // fire-and-forget: every state change routes through render()
  }

  const withActive = (fn) => { const a = DB.getActive(); if (!a) return; fn(a); DB.setActive(a); };
  function replaceAcc(i) { const a = DB.getActive(); const el = content.querySelector(`.card.entry[data-e="${i}"]`); if (a && el) el.outerHTML = renderAccCard(a.entries[i], i); }
  // Refresh a card in place after a set edit. Replacing it (replaceAcc) would destroy
  // the input the user is tapping into next and dismiss the iOS keyboard mid-entry.
  function syncAcc(i) {
    const a = DB.getActive(); const card = content.querySelector(`.card.entry[data-e="${i}"]`);
    if (!a || !card) return;
    const en = a.entries[i];
    const setVal = (el, v) => { if (el && el !== document.activeElement) el.value = v; };
    en.sets.forEach((s, k) => {
      const row = card.querySelector(`.set-row[data-s="${k}"]`); if (!row) return;
      row.classList.toggle('logged', s.reps > 0);
      setVal(row.querySelector('[data-action="set-w"]'), s.weight);
      setVal(row.querySelector('[data-action="set-reps"]'), s.reps > 0 ? s.reps : '');
    });
    const nextW = DB.nextWeightOf(en);
    setVal(card.querySelector('[data-action="acc-next"]'), nextW);
    card.querySelectorAll('[data-action="acc-next-bump"]').forEach(b => { b.textContent = `${+b.dataset.d < 0 ? '−' : '+'}${weightStep(nextW)}`; });
    const n = DB.doneSets(en).length;
    card.classList.toggle('done', n >= en.sets.length);
    const fill = card.querySelector('.cc-fill'); if (fill) fill.style.width = pct(n, en.sets.length) + '%';
  }

  /* ---------------- WORKOUT view ---------------- */
  function renderWorkout() {
    const active = DB.getActive();
    if (!active) return renderStart();

    const elapsed = active.startedAt ? Math.round((Date.now() - new Date(active.startedAt)) / 60000) : 0;
    return `
      <header class="hdr">
        <h1>${esc(dayName(active.day))}</h1>
        <div class="hdr-sub">${esc(fmtDate(active.date))} · ${elapsed} min · ${plural(active.entries.length, 'exercise')}</div>
      </header>
      <div class="entries">${active.entries.map((e, i) => renderAccCard(e, i)).join('')
        || '<div class="dim center pad">No exercises on this day — add some in the Program tab.</div>'}</div>
      <div class="finish-row">
        <button class="ghost-btn danger" data-action="discard">Discard</button>
        <button class="big-btn finish" data-action="finish">Finish workout</button>
      </div>`;
  }

  function renderStart() {
    const dayBtn = (day) => {
      const names = DB.getExercisesByDay(day).map(e => e.name);
      return `
        <button class="big-btn ${DAY_UI[day].btn}" data-action="start" data-day="${day}">Start ${esc(dayName(day))}</button>
        <div class="day-caption">${plural(names.length, 'exercise')}: ${names.map(esc).join(', ') || '—'}</div>`;
    };
    const last = DB.getSessions()[0];
    const lastHtml = last ? `
      <div class="card muted-card">
        <div class="card-title">Last · ${esc(fmtDate(last.date))} · ${esc(dayName(last.day))}</div>
        ${last.entries.filter(e => DB.doneSets(e).length).map(e =>
          `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
      </div>` : '';
    return `
      <header class="hdr"><h1>Augie Swole</h1>
        <div class="hdr-sub">Pick today's workout</div>
      </header>
      <div class="start-wrap">
        ${DB.DAYS.map(day => `<div class="day-block">${dayBtn(day)}</div>`).join('')}
        ${lastHtml}
      </div>`;
  }

  // One row per set: weight (editable per set) and the reps actually done. The first +
  // logs the target reps; − below 1 un-logs the set.
  function renderSetRow(e, idx, s, k) {
    return `
      <div class="set-row ${s.reps > 0 ? 'logged' : ''}" data-s="${k}">
        <span class="set-num">${k + 1}</span>
        ${e.bodyweight ? '<span></span>'
          : `<input class="weight-in set-in set-wt" type="number" inputmode="decimal" step="2.5" min="0" data-action="set-w" data-e="${idx}" data-s="${k}" value="${s.weight}" aria-label="Set ${k + 1} weight">`}
        <div class="set-r">
          <button class="step sm" data-action="set-reps-bump" data-e="${idx}" data-s="${k}" data-d="-1" aria-label="One less rep">−</button>
          <input class="weight-in set-in" type="number" inputmode="numeric" step="1" min="0" placeholder="${e.targetReps}" data-action="set-reps" data-e="${idx}" data-s="${k}" value="${s.reps > 0 ? s.reps : ''}" aria-label="Set ${k + 1} reps">
          <button class="step sm" data-action="set-reps-bump" data-e="${idx}" data-s="${k}" data-d="1" aria-label="One more rep">+</button>
        </div>
      </div>`;
  }

  function renderAccCard(e, idx) {
    const n = DB.doneSets(e).length;
    const all = n >= e.sets.length;
    const nextW = DB.nextWeightOf(e);
    const nextStep = weightStep(nextW);
    const nextCtrl = e.bodyweight ? '' : `
         <div class="weight-block">
           <div class="weight-row next">
             <span class="wr-label">Next time</span>
             <div class="wr-controls">
               <button class="step lg" data-action="acc-next-bump" data-e="${idx}" data-d="-1">−${nextStep}</button>
               <input class="weight-in lg" type="number" inputmode="decimal" step="2.5" min="0" data-action="acc-next" data-e="${idx}" value="${nextW}">
               <span class="wr-unit">${unit()}</span>
               <button class="step lg" data-action="acc-next-bump" data-e="${idx}" data-d="1">+${nextStep}</button>
             </div>
           </div>
         </div>`;
    return `
      <div class="card entry counter-card ${all ? 'done' : ''}" data-e="${idx}">
        <div class="cc-head"><div class="entry-title">${esc(e.name)}</div><span class="target-pill">${e.sets.length} × ${e.targetReps}</span></div>
        <div class="last-line">${lastAccText(e.exerciseId)}</div>
        <div class="set-table">
          <div class="set-row set-hdr"><span>Set</span><span>${e.bodyweight ? 'Bodyweight' : `Weight (${unit()})`}</span><span>Reps</span></div>
          ${e.sets.map((s, k) => renderSetRow(e, idx, s, k)).join('')}
        </div>
        <div class="set-tools">
          <button class="x-btn" data-action="set-add" data-e="${idx}">＋ Add set</button>
          ${e.sets.length > 1 ? `<button class="x-btn dim" data-action="set-remove" data-e="${idx}">− Remove set</button>` : ''}
        </div>
        ${nextCtrl}
        <div class="cc-bar"><div class="cc-fill" style="width:${pct(n, e.sets.length)}%"></div></div>
      </div>`;
  }

  /* ---------------- STATS view (charts) ---------------- */
  // points = [{ date(iso), value }] chronological. `domain` = shared {min,max} timestamps so
  // every chart uses the same time axis (a given date lines up across all charts).
  function sparkline(points, suffix, domain) {
    if (points.length < 2)
      return `<div class="dim small spark-empty">Not enough data yet — finish ${points.length ? 'another' : 'a couple of'} workout${points.length ? '' : 's'} to see a trend.</div>`;
    const W = 320, H = 86, padX = 10, padTop = 10, padBot = 22, plotH = H - padTop - padBot;
    const times = points.map(p => new Date(p.date).getTime());
    const vals = points.map(p => p.value);
    const tMin = domain ? domain.min : Math.min(...times);
    const tMax = domain ? domain.max : Math.max(...times);
    const tRange = tMax - tMin;
    const vMin = Math.min(...vals), vMax = Math.max(...vals), vRange = (vMax - vMin) || 1;
    const xOf = (t, i) => tRange ? padX + ((t - tMin) / tRange) * (W - 2 * padX) : padX + (i / (points.length - 1)) * (W - 2 * padX);
    const yOf = (v) => padTop + plotH - ((v - vMin) / vRange) * plotH;
    const pts = points.map((p, i) => [xOf(times[i], i), yOf(p.value)]);
    const line = pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    const area = `${pts[0][0].toFixed(1)},${padTop + plotH} ${line} ${pts[pts.length - 1][0].toFixed(1)},${padTop + plotH}`;
    const dots = points.map((p, i) =>
      `<circle class="spark-pt" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="3.4"/>` +
      `<circle class="dot" cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="14" fill="transparent" data-v="${esc(p.value + suffix)}" data-d="${esc(fmtDateTime(p.date))}"/>`
    ).join('');
    const xLabels = `<text class="spark-x" x="${padX}" y="${H - 6}" text-anchor="start">${esc(fmtAxis(tMin))}</text>` +
      (tRange ? `<text class="spark-x" x="${W - padX}" y="${H - 6}" text-anchor="end">${esc(fmtAxis(tMax))}</text>` : '');
    return `<svg class="spark" viewBox="0 0 ${W} ${H}"><polygon class="spark-area" points="${area}"/><polyline class="spark-line" points="${line}"/>${dots}${xLabels}</svg>`;
  }

  function statCard(name, points, suffix, subtitle, domain) {
    const latest = points.length ? points[points.length - 1].value : null;
    const first = points.length ? points[0].value : null;
    const delta = (latest != null && first != null) ? round(latest - first) : 0;
    const deltaTxt = points.length > 1 && delta !== 0 ? ` · ${delta > 0 ? '+' : ''}${delta}${suffix} since start` : '';
    const hint = points.length > 1 ? ' · tap a point for details' : '';
    return `
      <div class="card stat-card">
        <div class="stat-head"><b>${esc(name)}</b><span class="stat-latest">${latest != null ? latest + suffix : '—'}</span></div>
        ${subtitle ? `<div class="dim small stat-sub">${esc(subtitle)}</div>` : ''}
        ${sparkline(points, suffix, domain)}
        <div class="dim small">${plural(points.length, 'workout')}${deltaTxt}${hint}</div>
      </div>`;
  }

  function renderStats() {
    const cards = [];
    // Shared time axis across every chart.
    const allT = DB.getSessions().map(s => new Date(s.date).getTime());
    const domain = allT.length ? { min: Math.min(...allT), max: Math.max(...allT) } : null;
    DB.DAYS.forEach(day => {
      DB.getExercisesByDay(day).forEach(ex => {
        const s = DB.exerciseSeries(ex.id);
        if (!s.length) return;
        if (ex.bodyweight) cards.push(statCard(ex.name, s.map(d => ({ date: d.date, value: d.reps })), ' reps', `${dayName(day)} · total reps per workout`, domain));
        else cards.push(statCard(ex.name, s.map(d => ({ date: d.date, value: d.weight })), unit(), `${dayName(day)} · heaviest set`, domain));
      });
    });
    return `
      <header class="hdr"><h1>Stats</h1></header>
      ${cards.length ? cards.join('') : '<div class="dim center pad">No workouts logged yet. Your charts appear here.</div>'}`;
  }

  /* ---------------- GALAXY view (a slowly rotating sphere of stars — one per rep) ----------------
   * Canvas + requestAnimationFrame, deliberately NOT an animated SVG: iOS WebKit
   * re-rasterizes animated inline SVG on the main thread every frame, which is what
   * wedged the old bonsai tab. The rAF loop self-terminates the moment its canvas
   * leaves the DOM, degrades to ~30fps if frames run long, and renders a single
   * static frame under prefers-reduced-motion. */
  const STAR_CAP = 10000;
  const GALAXY_PHASES = [0, 30, 100, 250, 500, 1000, 2000, 3500, 5000, 7500, 10000];
  let galaxyPreview = null; // null = the real star count; otherwise a previewed count

  const shownStars = () => galaxyPreview !== null ? galaxyPreview : Math.min(DB.totalReps(), STAR_CAP);
  const fmtNum = (n) => n.toLocaleString();

  // Deterministic pseudo-random: star #i keeps the same spot forever, so each
  // workout only ADDS stars — the existing sky never rearranges.
  const gRnd = (i) => { const x = Math.sin((i + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };

  const galaxy = {
    raf: 0, canvas: null, ctx: null, w: 0, h: 0, glow: null, glowKey: '', sprite: null,
    built: false, n: -1, xs: null, ys: null, zs: null, tier: null, links: null,
    px: null, py: null, pa: null, pq: null, linkCache: new Map(),
    angle: 0.5, lastDraw: 0, ema: 0, heavy: false,
  };
  const GALAXY_MQ = matchMedia('(prefers-reduced-motion: reduce)');
  // Coalescing state for preview stepping — see scheduleGalaxyPaint below.
  let galaxyStepRaf = 0, galaxyStepRebuild = false;

  // Start or stop the rotation loop to match current state: stars to show, canvas
  // still in the DOM, and the live OS motion preference. An empty sky or a static
  // preference gets exactly one painted frame and no running loop.
  function syncGalaxyLoop() {
    const g = galaxy;
    const want = !!(g.canvas && g.canvas.isConnected && g.n > 0 && !GALAXY_MQ.matches);
    if (want && !g.raf) { g.lastDraw = 0; g.raf = requestAnimationFrame(galaxyTick); }
    else if (!want && g.raf) { cancelAnimationFrame(g.raf); g.raf = 0; }
  }

  // Star positions are a pure function of their index (gRnd), so they never change
  // with the count — build the full field ONCE and just vary how many we draw. This
  // keeps preview stepping allocation-free: the old per-step rebuild of seven typed
  // arrays plus a fresh offscreen glow canvas churned ~2 MB of IOSurface per tap,
  // which drove iOS into a compositor-commit stall while cycling previews (the freeze).
  function ensureGeometry() {
    const g = galaxy;
    if (g.built) return;
    const N = STAR_CAP;
    const xs = g.xs = new Float32Array(N), ys = g.ys = new Float32Array(N), zs = g.zs = new Float32Array(N);
    const tier = g.tier = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      const u = gRnd(i * 5 + 1) * 2 - 1;         // uniform cos(latitude)
      const th = gRnd(i * 5 + 2) * Math.PI * 2;
      // ~3/4 on a thick outer shell (reads as a sphere), the rest filling the core.
      const rad = gRnd(i * 5 + 3) < 0.75 ? 0.84 + 0.16 * gRnd(i * 5 + 4) : Math.cbrt(gRnd(i * 5 + 4)) * 0.8;
      const s = Math.sqrt(1 - u * u);
      xs[i] = Math.cos(th) * s * rad; ys[i] = u * rad; zs[i] = Math.sin(th) * s * rad;
      const t = gRnd(i * 5 + 5);
      tier[i] = t > 0.97 ? 2 : t > 0.78 ? 1 : 0; // bright / medium / faint
    }
    g.px = new Float32Array(N); g.py = new Float32Array(N);
    g.pa = new Float32Array(N); g.pq = new Uint8Array(N);
    g.built = true;
  }

  // Constellation web over the first n stars, memoized per count (11 preview phases →
  // at most 11 small arrays, so stepping never recomputes it). Links each star to its
  // nearest of the previous 7 when close enough — generous while sparse, tighter as
  // the sky fills; hard-capped so line drawing stays cheap at 10,000 stars.
  function linksFor(n) {
    const g = galaxy;
    let L = g.linkCache.get(n);
    if (L) return L;
    const xs = g.xs, ys = g.ys, zs = g.zs;
    const thr2 = n <= 200 ? 0.55 : n <= 1000 ? 0.2 : n <= 3000 ? 0.1 : 0.05;
    const pairs = [];
    for (let i = 1; i < n && pairs.length < 2800; i++) {
      let best = -1, bd = thr2;
      for (let j = Math.max(0, i - 7); j < i; j++) {
        const dx = xs[i] - xs[j], dy = ys[i] - ys[j], dz = zs[i] - zs[j];
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < bd) { bd = d2; best = j; }
      }
      if (best >= 0) pairs.push(i, best);
    }
    L = new Uint16Array(pairs);
    g.linkCache.set(n, L);
    return L;
  }

  // Point the engine at a star count — no allocation on the hot path once warmed.
  function setStarCount(n) {
    const g = galaxy;
    ensureGeometry();
    g.n = n;
    g.links = linksFor(n);
    ensureGlow();
  }

  // Soft golden core glow, baked ONCE per canvas size at full intensity; the
  // count-dependent brightness is applied cheaply via globalAlpha at draw time, so a
  // preview step never reallocates this canvas. Size-keyed (a rotation/resize rebuilds
  // it) and released in stopGalaxy so it never strands GPU memory off-tab.
  const GLOW_BAKE_A = 0.18; // == the a-value at n ≥ 3000; drawGalaxy scales down from here
  function ensureGlow() {
    const g = galaxy;
    if (!g.ctx || !g.w) { g.glow = null; g.glowKey = ''; return; }
    const key = g.w + 'x' + g.h;
    if (g.glow && g.glowKey === key) return;
    if (g.glow) g.glow.width = g.glow.height = 0; // release the old backing store now
    const c = document.createElement('canvas'); c.width = g.w; c.height = g.h;
    const x = c.getContext('2d'); if (!x) { g.glow = null; g.glowKey = ''; return; }
    const gr = x.createRadialGradient(g.w / 2, g.h / 2, 0, g.w / 2, g.h / 2, Math.min(g.w, g.h) * 0.5);
    gr.addColorStop(0, `rgba(244, 226, 158, ${GLOW_BAKE_A})`);
    gr.addColorStop(0.45, `rgba(200, 172, 92, ${(GLOW_BAKE_A * 0.4).toFixed(3)})`);
    gr.addColorStop(1, 'rgba(200, 172, 92, 0)');
    x.fillStyle = gr; x.fillRect(0, 0, g.w, g.h);
    g.glow = c; g.glowKey = key;
  }

  function buildSprite() {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d'); if (!x) return null;
    const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255, 252, 240, 1)');
    gr.addColorStop(0.2, 'rgba(248, 233, 178, 0.9)');
    gr.addColorStop(0.55, 'rgba(214, 182, 94, 0.28)');
    gr.addColorStop(1, 'rgba(214, 182, 94, 0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    return c;
  }

  const G_TILT_C = Math.cos(0.42), G_TILT_S = Math.sin(0.42); // fixed axial tilt
  const G_COL = ['#b9ab74', '#e9dcae'];                        // faint / medium gold
  function drawGalaxy() {
    const g = galaxy, ctx = g.ctx; if (!ctx) return;
    const w = g.w, h = g.h, cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.36;
    ctx.clearRect(0, 0, w, h);
    const n = g.n;
    if (g.glow) {
      // scale the baked full-intensity glow down to this count's brightness
      ctx.globalAlpha = (0.05 + 0.13 * Math.min(1, n / 3000)) / GLOW_BAKE_A;
      ctx.drawImage(g.glow, 0, 0);
      ctx.globalAlpha = 1;
    }
    if (!n) return;
    const ca = Math.cos(g.angle), sa = Math.sin(g.angle);
    const xs = g.xs, ys = g.ys, zs = g.zs, px = g.px, py = g.py, pa = g.pa, pq = g.pq;
    for (let i = 0; i < n; i++) {
      const xr = xs[i] * ca + zs[i] * sa;
      const zr0 = zs[i] * ca - xs[i] * sa;
      const yr = ys[i] * G_TILT_C - zr0 * G_TILT_S;
      const zr = zr0 * G_TILT_C + ys[i] * G_TILT_S;
      const k = 2.6 / (3 - zr); // simple perspective
      px[i] = cx + xr * k * R;
      py[i] = cy + yr * k * R;
      const q = (zr + 1) / 2;   // 0 = far side, 1 = near side
      pa[i] = 0.2 + 0.8 * q;
      pq[i] = q >= 0.667 ? 2 : q >= 0.333 ? 1 : 0;
    }
    // Constellation lines, batched into three depth buckets (few state changes).
    const L = g.links;
    if (L.length) {
      ctx.strokeStyle = '#d5c17a'; ctx.lineWidth = Math.max(1, R * 0.004);
      for (let b = 0; b < 3; b++) {
        ctx.globalAlpha = [0.06, 0.11, 0.18][b];
        ctx.beginPath();
        for (let l = 0; l < L.length; l += 2) {
          const i1 = L[l], i2 = L[l + 1];
          const am = (pa[i1] + pa[i2]) / 2;
          if ((am < 0.55 ? 0 : am < 0.8 ? 1 : 2) !== b) continue;
          ctx.moveTo(px[i1], py[i1]); ctx.lineTo(px[i2], py[i2]);
        }
        ctx.stroke();
      }
    }
    // Faint + medium stars as batched rects per (tier, depth) bucket.
    const tier = g.tier, s0 = Math.max(1.5, R * 0.007), s1 = Math.max(2.2, R * 0.011);
    for (let b = 0; b < 3; b++) {
      ctx.globalAlpha = [0.35, 0.65, 1][b];
      for (let t = 0; t < 2; t++) {
        ctx.fillStyle = G_COL[t];
        const sz = t ? s1 : s0, off = sz / 2;
        for (let i = 0; i < n; i++) {
          if (tier[i] !== t || pq[i] !== b) continue;
          ctx.fillRect(px[i] - off, py[i] - off, sz, sz);
        }
      }
    }
    // Bright stars (~3%) as pre-rendered glow sprites.
    if (g.sprite) {
      for (let i = 0; i < n; i++) {
        if (tier[i] !== 2) continue;
        const sz = R * 0.05 * (0.5 + 0.7 * pa[i]);
        ctx.globalAlpha = Math.min(1, 0.35 + 0.75 * pa[i]);
        ctx.drawImage(g.sprite, px[i] - sz / 2, py[i] - sz / 2, sz, sz);
      }
    }
    ctx.globalAlpha = 1;
  }

  // Cap the draw cadence by wall-clock, NOT by rAF cadence: ProMotion iPhones fire
  // rAF at 120 Hz, and running this heavy scene at 120 fps pins the GPU/compositor —
  // a core cause of the freeze. 30 fps is indistinguishable for a 90 s revolution and
  // quarters the pipeline load; sustained heavy frames back off to ~20 fps. Rotation
  // stays wall-clock-based so its speed is identical at any frame rate.
  function galaxyTick(t) {
    const g = galaxy;
    if (!g.canvas || !g.canvas.isConnected) return stopGalaxy(); // view was replaced
    g.raf = requestAnimationFrame(galaxyTick);
    const since = t - g.lastDraw;
    if (since < (g.heavy ? 50 : 33)) return; // throttle regardless of display refresh rate
    const dt = Math.min(0.1, since / 1000); g.lastDraw = t;
    g.angle += 0.07 * dt; // one revolution ≈ 90 s
    const t0 = performance.now();
    try { drawGalaxy(); } catch { stopGalaxy(); return; } // fail static, never wedge
    const ms = performance.now() - t0;
    g.ema = g.ema ? g.ema * 0.9 + ms * 0.1 : ms;
    g.heavy = g.ema > 20;
  }

  function stopGalaxy() {
    if (galaxy.raf) cancelAnimationFrame(galaxy.raf);
    if (galaxyStepRaf) { cancelAnimationFrame(galaxyStepRaf); galaxyStepRaf = 0; galaxyStepRebuild = false; }
    galaxy.raf = 0; galaxy.canvas = null; galaxy.ctx = null;
    // Release the glow's GPU backing now so it never strands IOSurface memory while
    // the user is on another tab (iOS frees canvas backing stores lazily).
    if (galaxy.glow) { galaxy.glow.width = galaxy.glow.height = 0; galaxy.glow = null; galaxy.glowKey = ''; }
  }

  function mountGalaxy() {
    stopGalaxy();
    const canvas = content.querySelector('canvas.galaxy'); if (!canvas) return;
    const g = galaxy;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    const css = canvas.clientWidth || 320;
    const dpr = Math.min(2, window.devicePixelRatio || 1); // 3× buys nothing here
    g.canvas = canvas; g.ctx = ctx;
    g.w = g.h = canvas.width = canvas.height = Math.max(1, Math.round(css * dpr));
    if (!g.sprite) g.sprite = buildSprite();
    setStarCount(shownStars());
    g.ema = 0; g.heavy = false; g.lastDraw = 0;
    drawGalaxy(); // first frame now — and the only one when the loop stays off
    syncGalaxyLoop();
    // A remount (resize / motion-pref change) runs stopGalaxy above, which drops any
    // pending coalesced preview-step paint. Reconcile the preview chrome to the live
    // galaxyPreview state so the controls/caption/aria can't be left stale.
    const wrap = canvas.closest('.galaxy-wrap');
    if (wrap) {
      canvas.setAttribute('aria-label', galaxyAria());
      const cap = wrap.querySelector('.galaxy-cap'); if (cap) cap.textContent = galaxyCaption();
      const ctrl = wrap.querySelector('.galaxy-controls'); if (ctrl) ctrl.innerHTML = galaxyControls();
    }
  }

  function galaxyCaption() {
    const shown = shownStars();
    if (galaxyPreview !== null) return `Preview — a sky of ${fmtNum(shown)} ${shown === 1 ? 'star' : 'stars'}.`;
    const total = DB.totalReps();
    if (!total) return 'An empty sky — every rep you log adds a star.';
    if (total > STAR_CAP) return `${fmtNum(total)} reps — your sky is full (${fmtNum(STAR_CAP)} stars shown).`;
    return `${fmtNum(total)} ${total === 1 ? 'star' : 'stars'} — one for every rep.`;
  }
  const galaxyAria = () => { const n = shownStars(); return `A slowly rotating sphere of ${fmtNum(n)} ${n === 1 ? 'star' : 'stars'}`; };
  const galaxyPreviewLabel = () => `Preview · ${fmtNum(galaxyPreview)} stars`;

  function galaxyControls() {
    if (galaxyPreview === null)
      return `<button class="ghost-btn small" data-action="galaxy-preview">👁 Preview the full sky</button>`;
    const idx = GALAXY_PHASES.indexOf(galaxyPreview);
    return `
      <div class="galaxy-preview-bar">
        <button class="step" data-action="galaxy-prev" aria-disabled="${idx <= 0}" aria-label="Fewer stars">◀</button>
        <span class="galaxy-preview-label">${esc(galaxyPreviewLabel())}</span>
        <button class="step" data-action="galaxy-next" aria-disabled="${idx >= GALAXY_PHASES.length - 1}" aria-label="More stars">▶</button>
      </div>
      <button class="ghost-btn small" data-action="galaxy-exit">Exit preview</button>`;
  }

  function renderGalaxy() {
    return `
      <header class="hdr"><h1>Your galaxy</h1>
        <div class="hdr-sub">One star for every rep</div></header>
      <div class="galaxy-wrap">
        <canvas class="galaxy" aria-label="${esc(galaxyAria())}"></canvas>
        <div class="galaxy-cap">${esc(galaxyCaption())}</div>
        <div class="galaxy-controls">${galaxyControls()}</div>
      </div>`;
  }

  // Targeted in-place update for preview stepping — the canvas node and the tapped
  // button are reused; only star data + captions change. (A full render here once
  // destroyed the control mid-tap and wedged the UI; keep it in-place.)
  function paintGalaxy(rebuildControls) {
    const wrap = content.querySelector('.galaxy-wrap'); if (!wrap) return;
    setStarCount(shownStars());
    syncGalaxyLoop(); // preview can step between 0 and >0 stars
    if (!galaxy.raf && galaxy.ctx) drawGalaxy(); // repaint the static frame (reduced motion / empty sky)
    const cv = wrap.querySelector('canvas.galaxy'); if (cv) cv.setAttribute('aria-label', galaxyAria());
    const cap = wrap.querySelector('.galaxy-cap'); if (cap) cap.textContent = galaxyCaption();
    if (rebuildControls) {
      const ctrl = wrap.querySelector('.galaxy-controls'); if (ctrl) ctrl.innerHTML = galaxyControls();
    } else {
      const label = wrap.querySelector('.galaxy-preview-label'); if (label) label.textContent = galaxyPreviewLabel();
      const idx = GALAXY_PHASES.indexOf(galaxyPreview);
      // aria-disabled (not the native `disabled` attribute) so the arrow under the
      // finger never stops being a hit-test/click target mid fast-tap. The handler
      // already clamps stepping with if (i>0)/if (i<len-1), so this is cosmetic only
      // — DO NOT remove those guards or stepping could run past an end.
      const prev = wrap.querySelector('[data-action="galaxy-prev"]'); if (prev) prev.setAttribute('aria-disabled', String(idx <= 0));
      const next = wrap.querySelector('[data-action="galaxy-next"]'); if (next) next.setAttribute('aria-disabled', String(idx >= GALAXY_PHASES.length - 1));
    }
  }

  // Coalesce rapid preview taps into ONE repaint per animation frame. Fast cycling
  // fires many synchronous galaxy-prev/next clicks between frames; each ran
  // setStarCount + DOM writes while the rAF star loop was drawing, and on iOS that
  // burst saturated the compositor commit path until it wedged — the whole screen
  // shifted down and the tab bar + Exit went dead until a force-quit. The index
  // still advances on every tap; only the (idempotent) repaint is debounced to the
  // frame, so tap RATE no longer drives main-thread/compositor load. A lone slow tap
  // is unaffected apart from painting ~one frame later.
  function scheduleGalaxyPaint(rebuildControls) {
    if (rebuildControls) galaxyStepRebuild = true;
    if (galaxyStepRaf) return;
    galaxyStepRaf = requestAnimationFrame(() => {
      galaxyStepRaf = 0;
      const rebuild = galaxyStepRebuild; galaxyStepRebuild = false;
      paintGalaxy(rebuild);
    });
  }

  /* ---------------- HISTORY view ---------------- */
  let openSession = null;
  function renderHistory() {
    const sessions = DB.getSessions();
    if (!sessions.length)
      return `<header class="hdr"><h1>History</h1></header><div class="dim center pad">No finished workouts yet.</div>`;
    const items = sessions.map(s => {
      const open = openSession === s.id;
      const done = s.entries.filter(e => DB.doneSets(e).length);
      const reps = done.reduce((n, e) => n + DB.repsOf(e), 0);
      const body = open ? `<div class="sess-body">
          ${done.map(e =>
            `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
          <button class="ghost-btn danger small" data-action="delete-session" data-id="${s.id}">Delete</button>
        </div>` : '';
      return `<div class="card sess ${open ? 'open' : ''}">
          <div class="sess-head" data-action="toggle-session" data-id="${s.id}">
            <div><div class="card-title">${esc(dayName(s.day))} · ${esc(fmtDate(s.date))}</div>
              <div class="dim small">${plural(done.length, 'exercise')} · ${plural(reps, 'rep')}</div></div>
            <span class="chev">${open ? '▾' : '▸'}</span>
          </div>${body}</div>`;
    }).join('');
    return `<header class="hdr"><h1>History</h1></header><div class="list">${items}</div>`;
  }

  /* ---------------- PROGRAM view ---------------- */
  function renderProgram() {
    const dayList = (day) => `<div class="prog-list" data-day="${day}">${
      DB.getExercisesByDay(day).map(e => `
      <div class="prog-row" data-id="${e.id}">
        <span class="drag-handle" aria-label="Drag to reorder">≡</span>
        <div class="prog-info"><b>${esc(e.name) || '(unnamed)'}</b>
          <span class="dim small">${e.bodyweight ? `${e.sets} × ${e.reps} · bodyweight` : `${e.sets} × ${e.reps} @ ${e.weight}${unit()}`}</span></div>
        <button class="x-btn" data-action="edit-ex" data-id="${e.id}">Edit</button>
      </div>`).join('') || '<div class="dim small">No exercises.</div>'
    }</div>`;
    return `
      <header class="hdr"><h1>Program</h1></header>
      ${DB.DAYS.map(day => `
      <div class="card">
        <div class="card-title">${esc(dayName(day))}${DAY_UI[day].sub ? ` <span class="dim small">${esc(DAY_UI[day].sub)}</span>` : ''}</div>
        ${dayList(day)}
        <button class="add-row-btn" data-action="add-ex" data-day="${day}">＋ Add ${day} exercise</button>
      </div>`).join('')}
      <div class="dim center small">Drag ≡ to reorder. Each workout runs its day's exercises in this order.</div>`;
  }

  /* ---------------- exercise editor (modal) ---------------- */
  let editing = null;
  function openEditor(ex) {
    editing = JSON.parse(JSON.stringify(ex));
    const ov = document.createElement('div');
    ov.className = 'overlay'; ov.id = 'editor-ov';
    ov.appendChild(buildEditor());
    document.body.appendChild(ov);
    ov.addEventListener('click', (ev) => { if (ev.target === ov) closeEditor(); });
    setTimeout(() => { const n = ov.querySelector('#ed-name'); n && n.focus(); }, 50);
  }
  function closeEditor() { const ov = document.getElementById('editor-ov'); if (ov) ov.remove(); editing = null; }
  function buildEditor() {
    const e = editing;
    const exists = !!DB.getExercise(e.id);
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.innerHTML = `
      <div class="sheet-head"><b>${exists ? 'Edit exercise' : 'New exercise'}</b><button class="x-btn" data-ed="close">✕</button></div>
      <label class="field"><span>Name</span><input id="ed-name" type="text" value="${esc(e.name)}" placeholder="Exercise name" autocomplete="off"></label>
      <label class="field"><span>Day</span><select id="ed-day">
        ${DB.DAYS.map(d => `<option value="${d}" ${e.day === d ? 'selected' : ''}>${esc(dayName(d))}</option>`).join('')}</select></label>
      <label class="field"><span>Type</span><select id="ed-type">
        <option value="weight" ${!e.bodyweight ? 'selected' : ''}>Weighted</option>
        <option value="bw" ${e.bodyweight ? 'selected' : ''}>Bodyweight</option></select></label>
      <div class="ed-grid">
        <label class="field"><span>Sets</span><input id="ed-sets" type="number" min="1" step="1" value="${e.sets}"></label>
        <label class="field"><span>Target reps</span><input id="ed-reps" type="number" min="1" step="1" value="${e.reps}"></label>
        <label class="field" id="ed-weight-wrap" ${e.bodyweight ? 'hidden' : ''}><span>Weight (${unit()})</span><input id="ed-weight" type="number" min="0" step="2.5" value="${e.weight}"></label>
      </div>
      <div class="btn-col">
        <button class="big-btn" data-ed="save">Save</button>
        ${exists ? '<button class="ghost-btn danger" data-ed="delete">Delete exercise</button>' : ''}
      </div>`;
    sheet.addEventListener('click', (ev) => {
      const act = ev.target.closest('[data-ed]'); if (!act) return;
      if (act.dataset.ed === 'close') return closeEditor();
      if (act.dataset.ed === 'delete') { confirmDialog('Delete this exercise? Past history is kept.', () => { DB.deleteExercise(e.id); closeEditor(); render(); }, { confirmText: 'Delete', danger: true }); return; }
      if (act.dataset.ed === 'save') saveEditor(sheet);
    });
    sheet.addEventListener('change', (ev) => {
      if (ev.target.id === 'ed-type') sheet.querySelector('#ed-weight-wrap').hidden = (ev.target.value !== 'weight');
    });
    return sheet;
  }
  function saveEditor(sheet) {
    const bodyweight = sheet.querySelector('#ed-type').value !== 'weight';
    const ex = {
      id: editing.id, name: sheet.querySelector('#ed-name').value.trim(), day: sheet.querySelector('#ed-day').value,
      bodyweight,
      sets: Math.max(1, parseInt(sheet.querySelector('#ed-sets').value, 10) || 1),
      reps: Math.max(1, parseInt(sheet.querySelector('#ed-reps').value, 10) || 1),
      weight: bodyweight ? 0 : Math.max(0, Number(sheet.querySelector('#ed-weight').value) || 0),
    };
    if (!ex.name) { alertDialog('Please enter a name.'); return; }
    DB.upsertExercise(ex); closeEditor(); render();
  }

  /* ---------------- BACKUP view ---------------- */
  function renderBackup() {
    const s = DB.getSettings();
    return `
      <header class="hdr"><h1>Backup &amp; Settings</h1></header>
      <div class="card">
        <div class="card-title">Units</div>
        <label class="field row-field"><span>Weight unit</span><select id="set-unit" data-action="save-unit">
          <option value="lb" ${s.unit === 'lb' ? 'selected' : ''}>lb</option>
          <option value="kg" ${s.unit === 'kg' ? 'selected' : ''}>kg</option></select></label>
      </div>
      <div class="card">
        <div class="card-title">Backup</div>
        <div class="dim small">All data lives only on this device. Export regularly to keep a copy.</div>
        <div class="btn-col">
          <button class="ghost-btn" data-action="export">⬇ Export data (.json)</button>
          <button class="ghost-btn" data-action="import">⬆ Import data</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden>
        </div>
      </div>
      <div class="card"><div class="card-title danger">Danger zone</div>
        <button class="ghost-btn danger" data-action="clear">Erase all data</button></div>
      <div class="dim center small pad">Augie Swole · offline-first · v4</div>`;
  }

  /* ---------------- screen wake lock (display stays on during an active workout) ---------------- */
  // Held only while a workout is active AND the app is visible. iOS auto-releases
  // the lock when the app is backgrounded, so visibilitychange re-acquires it on
  // return. render() re-syncs after every state change (start/finish/discard/
  // import/erase all call render). No-op where the API is unsupported; a denied
  // request (e.g. Low Power Mode) is silently accepted — the app must never block
  // on this.
  let wakeLock = null, wakeLockBusy = false;
  async function syncWakeLock() {
    if (wakeLockBusy) return;
    const wanted = () => !!(('wakeLock' in navigator) && DB.getActive() && document.visibilityState === 'visible');
    const want = wanted();
    if (want === !!wakeLock) return;
    wakeLockBusy = true;
    let failed = false;
    try {
      if (wakeLock) {
        const wl = wakeLock; wakeLock = null;
        await wl.release();
      } else {
        const wl = await navigator.wakeLock.request('screen');
        wl.addEventListener('release', () => { if (wakeLock === wl) wakeLock = null; });
        wakeLock = wl;
      }
    } catch { failed = true; /* denied or already released — never surface this */ }
    wakeLockBusy = false;
    // Settle, in BOTH directions, any state change the busy guard swallowed
    // mid-flight (e.g. foregrounded again while the backgrounding release was
    // still pending — set-taps don't re-render, so nothing else would retry).
    // A failed attempt at the SAME desired state is not retried, or a denial
    // (e.g. Low Power Mode) would spin; the next state change retries it.
    const wantNow = wanted();
    if (wantNow !== !!wakeLock && !(failed && wantNow === want)) syncWakeLock();
  }
  document.addEventListener('visibilitychange', () => { syncWakeLock(); });

  /* ---------------- clicks ---------------- */
  content.addEventListener('click', (ev) => {
    const dot = ev.target.closest ? ev.target.closest('circle.dot') : null;
    if (dot) { showChartTip(dot); return; }
    hideChartTip();
    const t = ev.target.closest('[data-action]'); if (!t) return;
    const a = t.dataset.action;
    const e = t.dataset.e != null ? +t.dataset.e : null;

    switch (a) {
      case 'start': DB.startSession(t.dataset.day); render(); break;

      case 'set-reps-bump': withActive(x => {
        const en = x.entries[e], s = en.sets[+t.dataset.s], d = +t.dataset.d;
        if (s.reps > 0) s.reps = s.reps + d > 0 ? s.reps + d : null;
        else if (d > 0) { s.reps = en.targetReps || 1; haptic(10); }
      }); syncAcc(e); break;
      case 'set-add': withActive(x => { const en = x.entries[e]; const last = en.sets[en.sets.length - 1]; en.sets.push({ weight: last ? last.weight : en.weight, reps: null }); }); replaceAcc(e); break;
      case 'set-remove': withActive(x => { const en = x.entries[e]; if (en.sets.length > 1) en.sets.pop(); }); replaceAcc(e); break;
      case 'acc-next-bump': withActive(x => { const en = x.entries[e]; const cur = Number(DB.nextWeightOf(en)) || 0; en.nextWeight = Math.max(0, round(cur + (+t.dataset.d) * weightStep(cur))); }); syncAcc(e); break;

      case 'finish': {
        const saved = DB.finishActive();
        if (saved) { openSession = saved.id; view = 'history'; }
        render();
        break;
      }
      case 'discard': confirmDialog('Discard this workout? Nothing will be saved.', () => { DB.discardActive(); render(); }, { confirmText: 'Discard', danger: true }); break;

      case 'toggle-session': openSession = openSession === t.dataset.id ? null : t.dataset.id; render(); break;
      case 'delete-session': { const id = t.dataset.id; confirmDialog('Delete this workout from history?', () => { DB.deleteSession(id); render(); }, { confirmText: 'Delete', danger: true }); break; }

      case 'add-ex': openEditor(DB.newExercise(t.dataset.day)); break;
      case 'edit-ex': { const ex = DB.getExercise(t.dataset.id); if (ex) openEditor(ex); break; }

      case 'galaxy-preview': { const cur = Math.min(DB.totalReps(), STAR_CAP); galaxyPreview = GALAXY_PHASES.filter(n => n <= cur).pop() ?? 0; scheduleGalaxyPaint(true); break; }
      case 'galaxy-prev': { const i = GALAXY_PHASES.indexOf(galaxyPreview); if (i > 0) { galaxyPreview = GALAXY_PHASES[i - 1]; scheduleGalaxyPaint(false); } break; }
      case 'galaxy-next': { const i = GALAXY_PHASES.indexOf(galaxyPreview); if (i < GALAXY_PHASES.length - 1) { galaxyPreview = GALAXY_PHASES[i + 1]; scheduleGalaxyPaint(false); } break; }
      case 'galaxy-exit': galaxyPreview = null; scheduleGalaxyPaint(true); break;

      case 'export': doExport(); break;
      case 'import': document.getElementById('import-file').click(); break;
      case 'clear': confirmDialog('Erase ALL data on this device? This cannot be undone.', () =>
        confirmDialog('Really erase everything?', () => { DB.clearAll(); DB.seedIfEmpty(); openSession = null; view = 'workout'; render(); }, { confirmText: 'Erase everything', danger: true }),
        { confirmText: 'Continue', danger: true }); break;
    }
  });

  /* ---------------- changes ---------------- */
  content.addEventListener('change', (ev) => {
    const t = ev.target.closest('[data-action]'); if (!t) return;
    const act = t.dataset.action;
    const e = +t.dataset.e, k = +t.dataset.s;
    if (act === 'acc-next') { withActive(x => { x.entries[e].nextWeight = Math.max(0, Number(t.value) || 0); }); syncAcc(e); }
    else if (act === 'set-w') {
      withActive(x => {
        const sets = x.entries[e].sets, old = sets[k].weight, v = Math.max(0, Number(t.value) || 0);
        sets[k].weight = v;
        // Later unlogged sets still at the old weight follow along, so a new working weight is typed once.
        for (let j = k + 1; j < sets.length; j++) if (!(sets[j].reps > 0) && sets[j].weight === old) sets[j].weight = v;
      });
      syncAcc(e);
    }
    else if (act === 'set-reps') { withActive(x => { const n = parseInt(t.value, 10); x.entries[e].sets[k].reps = n > 0 ? n : null; }); syncAcc(e); }
    else if (act === 'save-unit') { const s = DB.getSettings(); s.unit = t.value; DB.saveSettings(s); }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id !== 'import-file' || !ev.target.files.length) return;
    const reader = new FileReader();
    reader.onload = () => { try { DB.importAll(JSON.parse(reader.result)); openSession = null; render(); alertDialog('Data imported.'); } catch (err) { alertDialog('Import failed: ' + err.message); } };
    reader.readAsText(ev.target.files[0]);
    ev.target.value = ''; // allow re-selecting the same file (change won't fire otherwise)
  });

  function doExport() {
    const blob = new Blob([JSON.stringify(DB.exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `augie-swole-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------------- drag-to-reorder (Program tab) ---------------- */
  let drag = null;
  function dragAfter(list, y) {
    let best = { offset: -Infinity, el: null };
    for (const row of list.querySelectorAll('.prog-row:not(.dragging)')) {
      const box = row.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > best.offset) best = { offset, el: row };
    }
    return best.el;
  }
  content.addEventListener('pointerdown', (ev) => {
    const handle = ev.target.closest && ev.target.closest('.drag-handle'); if (!handle) return;
    const row = handle.closest('.prog-row'); const list = row && row.parentElement;
    if (!row || !list) return;
    ev.preventDefault();
    drag = { row, list };
    row.classList.add('dragging');
  });
  // Move/end tracked on window so a touch that strays off the row — or lifts anywhere,
  // off-screen included — still ends the drag and can never wedge the UI.
  window.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    ev.preventDefault();
    const after = dragAfter(drag.list, ev.clientY);
    if (after == null) drag.list.appendChild(drag.row);
    else drag.list.insertBefore(drag.row, after);
  }, { passive: false });
  function endDrag() {
    if (!drag) return;
    const { row, list } = drag; drag = null;
    try {
      row.classList.remove('dragging');
      DB.reorderDay(list.dataset.day, [...list.querySelectorAll('.prog-row')].map(r => r.dataset.id));
    } catch (e) { /* ignore */ }
    render();
  }
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);

  /* ---------------- tabs + boot ---------------- */
  tabbar.addEventListener('click', (ev) => { const b = ev.target.closest('.tab'); if (!b) return; view = b.dataset.tab; galaxyPreview = null; render(); });

  // Keep the galaxy canvas backing store matched to its CSS size (e.g. phone
  // rotation). Debounced: desktop window-dragging fires dozens of events/sec and
  // each remount allocates a fresh glow canvas.
  let galaxyResizeT = 0;
  window.addEventListener('resize', () => {
    if (view !== 'galaxy') return;
    clearTimeout(galaxyResizeT);
    galaxyResizeT = setTimeout(() => { if (view === 'galaxy' && content.querySelector('canvas.galaxy')) mountGalaxy(); }, 150);
  });
  // React to the OS motion preference changing while the tab is open.
  const onMotionPref = () => { if (view === 'galaxy' && content.querySelector('canvas.galaxy')) mountGalaxy(); };
  try { GALAXY_MQ.addEventListener('change', onMotionPref); } catch { GALAXY_MQ.addListener && GALAXY_MQ.addListener(onMotionPref); }

  content.addEventListener('scroll', hideChartTip, { passive: true });

  DB.seedIfEmpty();
  render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

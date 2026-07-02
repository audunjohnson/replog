/* app.js — Augie Swole UI. Vanilla JS, no framework, no build step. */
(() => {
  'use strict';

  const content = document.getElementById('content');
  const tabbar = document.getElementById('tabbar');
  let view = 'workout';
  let plantPreview = null; // null = real workout count; otherwise a previewed count
  const PLANT_PHASES = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  /* ---------------- helpers ---------------- */
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const dayName = (d) => (d === 'push' ? 'Push day' : 'Leg day');
  const haptic = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
  const unit = () => DB.getSettings().unit;
  const round = (n) => Math.round(n * 10) / 10;
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
    const e = last.entry;
    const w = e.bodyweight ? '' : `${e.weight}${e.unit} · `;
    return `Last · ${esc(fmtDate(last.date))}: ${w}${e.done} × ${e.targetReps}`;
  }

  function accSessionSummary(e) {
    const w = e.bodyweight ? '' : `${e.weight}${e.unit} · `;
    return `${w}${e.done} × ${e.targetReps}`;
  }

  /* ---------------- top-level render ---------------- */
  function render() {
    drag = null; // safety: any re-render (e.g. tab switch) clears a stuck drag
    hideChartTip();
    [...tabbar.children].forEach(b => b.classList.toggle('active', b.dataset.tab === view));
    // Safety net: if a view throws (e.g. malformed imported data), show what broke
    // instead of leaving stale DOM where every tap silently re-throws — which
    // looks exactly like a frozen app.
    try {
      if (view === 'workout') content.innerHTML = renderWorkout();
      if (view === 'stats') content.innerHTML = renderStats();
      if (view === 'plant') content.innerHTML = renderPlant();
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
  }

  const withActive = (fn) => { const a = DB.getActive(); if (!a) return; fn(a); DB.setActive(a); };
  function replacePull() { const a = DB.getActive(); const el = content.querySelector('.pull-sticky'); if (a && el) el.outerHTML = renderPullCounter(a); }
  function replaceAcc(i) { const a = DB.getActive(); const el = content.querySelector(`.card.entry[data-e="${i}"]`); if (a && el) el.outerHTML = renderAccCard(a.entries[i], i); }

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
      ${renderPullCounter(active)}
      <div class="entries">${active.entries.map((e, i) => renderAccCard(e, i)).join('')
        || '<div class="dim center pad">No accessories today.</div>'}</div>
      <div class="finish-row">
        <button class="ghost-btn danger" data-action="discard">Discard</button>
        <button class="big-btn finish" data-action="finish">Finish workout</button>
      </div>`;
  }

  function renderStart() {
    const p = DB.getProgram();
    const n = DB.exerciseCountForSets(p.sets);
    const dayBtn = (day, cls) => {
      const names = DB.plannedExercises(day).map(e => e.name);
      return `
        <button class="big-btn ${cls}" data-action="start" data-day="${day}">Start ${esc(dayName(day))}</button>
        <div class="day-caption">${plural(names.length, 'exercise')} today: ${names.map(esc).join(', ') || '—'}</div>`;
    };
    const last = DB.getSessions()[0];
    const lastHtml = last ? `
      <div class="card muted-card">
        <div class="card-title">Last · ${esc(fmtDate(last.date))} · ${esc(dayName(last.day))}</div>
        <div class="row-line"><b>Pull-ups</b><span>${last.pullups.done} × ${last.pullups.targetReps}</span></div>
        ${last.entries.filter(e => e.done > 0).map(e =>
          `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
      </div>` : '';
    return `
      <header class="hdr"><h1>Augie Swole</h1>
        <div class="hdr-sub">Next pull-ups: <b style="color:var(--accent)">${p.sets} × ${p.reps}</b> · ${n} ${n === 1 ? 'accessory' : 'accessories'}</div>
      </header>
      <div class="start-wrap">
        <div class="day-block">${dayBtn('push', '')}</div>
        <div class="day-block">${dayBtn('leg', 'alt')}</div>
        ${lastHtml}
      </div>`;
  }

  // Sticky pull-up set counter (top of the workout screen).
  function renderPullCounter(s) {
    const p = s.pullups;
    const pct = p.targetSets ? Math.min(100, Math.round((p.done / p.targetSets) * 100)) : 0;
    const all = p.targetSets > 0 && p.done >= p.targetSets;
    const next = DB.nextLevel(Object.assign({}, DB.getProgram(), { sets: p.targetSets, reps: p.targetReps }));
    return `
      <div class="pull-sticky">
        <div class="card counter-card pull ${all ? 'done' : ''}">
          <div class="cc-head"><b>Pull-ups</b><span class="target-pill">${p.targetSets} × ${p.targetReps}</span></div>
          <div class="cc-body">
            <button class="cc-btn minus" data-action="pull-dec" aria-label="Undo a set">−</button>
            <div class="cc-count"><span class="cc-num">${p.done}</span><span class="cc-of">/ ${p.targetSets} sets</span></div>
            <button class="cc-btn plus" data-action="pull-inc">+1 set</button>
          </div>
          <div class="cc-bar"><div class="cc-fill" style="width:${pct}%"></div></div>
          ${all ? `<div class="advance">✓ all sets done · next workout ${next.sets} × ${next.reps}</div>` : ''}
        </div>
      </div>`;
  }

  function renderAccCard(e, idx) {
    const all = e.done >= e.targetSets;
    const pct = e.targetSets ? Math.min(100, Math.round((e.done / e.targetSets) * 100)) : 0;
    const nowW = e.weight;
    const nextW = (typeof e.nextWeight === 'number') ? e.nextWeight : e.weight;
    const nowStep = weightStep(nowW), nextStep = weightStep(nextW);
    const weightCtrl = e.bodyweight
      ? `<div class="bw-tag">bodyweight · ${e.targetReps} reps</div>`
      : `<div class="weight-block">
           <div class="weight-row now">
             <span class="wr-label">This workout</span>
             <div class="wr-controls">
               <button class="step sm" data-action="acc-now-bump" data-e="${idx}" data-d="-1">−${nowStep}</button>
               <input class="weight-in sm" type="number" inputmode="decimal" step="2.5" min="0" data-action="acc-now" data-e="${idx}" value="${nowW}">
               <span class="wr-unit">${unit()}</span>
               <button class="step sm" data-action="acc-now-bump" data-e="${idx}" data-d="1">+${nowStep}</button>
             </div>
           </div>
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
        <div class="cc-head"><div class="entry-title">${esc(e.name)}</div><span class="target-pill">${e.targetSets} × ${e.targetReps}</span></div>
        <div class="last-line">${lastAccText(e.exerciseId)}</div>
        ${weightCtrl}
        <div class="cc-body">
          <button class="cc-btn minus" data-action="acc-dec" data-e="${idx}" aria-label="Undo a set">−</button>
          <div class="cc-count"><span class="cc-num">${e.done}</span><span class="cc-of">/ ${e.targetSets} sets</span></div>
          <button class="cc-btn plus" data-action="acc-inc" data-e="${idx}">+1 set</button>
        </div>
        <div class="cc-bar"><div class="cc-fill" style="width:${pct}%"></div></div>
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
    const pu = DB.pullupSeries();
    const cards = [];
    const p = DB.getProgram();
    // Shared time axis across every chart.
    const allT = DB.getSessions().map(s => new Date(s.date).getTime());
    const domain = allT.length ? { min: Math.min(...allT), max: Math.max(...allT) } : null;
    cards.push(statCard('Pull-ups', pu.map(d => ({ date: d.date, value: d.total })), ' reps', `Total reps per workout · now at ${p.sets} × ${p.reps}`, domain));
    ['push', 'leg'].forEach(day => {
      DB.getExercisesByDay(day).forEach(ex => {
        const s = DB.exerciseSeries(ex.id);
        if (!s.length) return;
        if (ex.bodyweight) cards.push(statCard(ex.name, s.map(d => ({ date: d.date, value: d.done * d.reps })), ' reps', `${dayName(day)} · total reps per workout`, domain));
        else cards.push(statCard(ex.name, s.map(d => ({ date: d.date, value: d.weight })), unit(), `${dayName(day)} · working weight`, domain));
      });
    });
    const any = pu.length || DB.getSessions().length;
    return `
      <header class="hdr"><h1>Stats</h1></header>
      ${any ? cards.join('') : '<div class="dim center pad">No workouts logged yet. Your charts appear here.</div>'}`;
  }

  /* ---------------- PLANT view (a bonsai shaped by each finished workout) ---------------- */
  function plantSVG(count) {
    const W = 300, H = 360, cx = 150, soilY = 292;
    // Deterministic pseudo-random so the same count always yields the same tree.
    const rnd = (i) => { const x = Math.sin((i + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };

    // Progress runs 0→100 workouts; 100 is the cap — the biggest, most gnarled tree.
    const p = Math.min(count, 100) / 100; // 0..1
    const e = Math.sqrt(p);               // ease: grows fast early, settles toward the cap

    // Growth scalars, all maxing out at 100 workouts.
    const trunkH = count === 0 ? 26 : Math.round(44 + 128 * Math.pow(p, 0.6));
    const baseW  = count === 0 ? 4  : 7 + 25 * Math.pow(p, 0.55);
    const bends  = count === 0 ? 1  : 2 + Math.round(10 * e);
    const lean   = (rnd(2) - 0.5) * 26;

    // Trunk centreline (base -> apex), meandering and leaning for a gnarled look.
    const N = bends + 1;
    const cl = [];
    for (let k = 0; k <= N; k++) {
      const t = k / N;
      const y = soilY - t * trunkH;
      let x = cx;
      if (k > 0) {
        const zig = ((k % 2) ? 1 : -1) * (1 - t) * (10 + Math.min(bends, 8));
        x = cx + lean * t + zig + (rnd(k * 5) - 0.5) * 7;
      }
      cl.push([x, y]);
    }
    const apex = cl[N];

    // Tapered trunk as a filled outline (wide nebari base -> thin apex).
    const wAt = (t) => baseW * (1 - 0.72 * t) * 0.5 + 1;
    const leftPts  = cl.map(([x, y], k) => [x - wAt(k / N), y]);
    const rightPts = cl.map(([x, y], k) => [x + wAt(k / N), y]);
    const trunkD =
      'M ' + leftPts.map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ') +
      ' L ' + [...rightPts].reverse().map(p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' L ') + ' Z';
    const fw = baseW * 0.9; // root flare (nebari) gripping the soil
    const roots = `<path class="bn-trunk" d="M ${(cx - fw).toFixed(1)} ${soilY + 4} Q ${(cx - fw * 0.7).toFixed(1)} ${soilY - 6} ${(cx - fw * 0.25).toFixed(1)} ${soilY - 7} L ${(cx + fw * 0.25).toFixed(1)} ${soilY - 7} Q ${(cx + fw * 0.7).toFixed(1)} ${soilY - 6} ${(cx + fw).toFixed(1)} ${soilY + 4} Z"/>`;
    const trunk = `<path class="bn-trunk" d="${trunkD}"/>`;

    // Interpolate trunk x at a height fraction (0 = base, 1 = apex).
    const xAt = (f) => {
      const yt = soilY - f * trunkH;
      for (let k = 0; k < N; k++) {
        const [x1, y1] = cl[k], [x2, y2] = cl[k + 1];
        if (yt <= y1 && yt >= y2) return x1 + (x2 - x1) * ((y1 - yt) / ((y1 - y2) || 1));
      }
      return apex[0];
    };

    // A foliage pad: a layered cloud of green blobs. Lobe count grows toward the cap (denser canopy).
    const lobes = 5 + Math.round(5 * e);
    const padCenters = [];
    const pad = (px, py, r, seed) => {
      padCenters.push([px, py, r]);
      let s = `<ellipse class="bn-pad-d" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" rx="${r.toFixed(1)}" ry="${(r * 0.72).toFixed(1)}"/>`;
      for (let k = 0; k < lobes; k++) {
        const a = (k / lobes) * Math.PI * 2 + rnd(seed + k) * 2;
        const rr = r * (0.46 + rnd(seed * 2 + k) * 0.34);
        const ox = Math.cos(a) * r * 0.55;
        const oy = Math.sin(a) * r * 0.42 - r * 0.12;
        s += `<circle class="${k % 2 ? 'bn-pad-m' : 'bn-pad-l'}" cx="${(px + ox).toFixed(1)}" cy="${(py + oy).toFixed(1)}" r="${rr.toFixed(1)}"/>`;
      }
      return s;
    };

    let branches = '', pads = '', accents = '';
    if (count === 0) {
      // A bare sapling: two thin twig stubs, no foliage yet.
      branches = `<path class="bn-branch" d="M ${apex[0].toFixed(1)} ${apex[1].toFixed(1)} q -8 -3 -12 -10"/>` +
                 `<path class="bn-branch" d="M ${apex[0].toFixed(1)} ${apex[1].toFixed(1)} q 8 -3 12 -11"/>`;
    } else {
      const nB = Math.min(8, count);
      const padBase = 14 + 10 * e;
      for (let i = 0; i < nB; i++) {
        const fb = nB === 1 ? 0.62 : 0.34 + 0.6 * (i / (nB - 1));
        const by = soilY - fb * trunkH;
        const bx = xAt(fb);
        const side = (i % 2) ? 1 : -1;
        const reach = 28 + (1 - fb) * 12 + rnd(i * 7) * 12;
        const px = bx + side * reach;
        const py = by - 8 - rnd(i * 9) * 10;
        branches += `<path class="bn-branch" d="M ${bx.toFixed(1)} ${by.toFixed(1)} Q ${(bx + side * reach * 0.5).toFixed(1)} ${(by - 2).toFixed(1)} ${px.toFixed(1)} ${py.toFixed(1)}"/>`;
        pads += pad(px, py, padBase * (0.8 + rnd(i * 11) * 0.4), i + 1);
      }
      pads += pad(apex[0], apex[1] - 4, padBase * 1.2, 99); // apex crown

      // --- Milestones in the canopy (one every 10 workouts). ---
      // 20: blossoms scattered through the canopy.
      if (count >= 20 && padCenters.length) {
        const nBloss = 4 + Math.round(p * 18);
        for (let i = 0; i < nBloss; i++) {
          const c = padCenters[Math.floor(rnd(i * 13) * padCenters.length)];
          const a = rnd(i * 17) * Math.PI * 2, rr = rnd(i * 19) * c[2] * 0.8;
          const bxp = c[0] + Math.cos(a) * rr, byp = c[1] + Math.sin(a) * rr * 0.72;
          accents += `<circle class="bn-blossom" cx="${bxp.toFixed(1)}" cy="${byp.toFixed(1)}" r="${(2.1 + rnd(i * 23) * 1.3).toFixed(1)}"/>`;
        }
      }
      // 40: deadwood jin/shari — a stripped, pale branch showing age.
      if (count >= 40) {
        const jy = soilY - 0.5 * trunkH, jx = xAt(0.5);
        accents += `<path class="bn-jin" d="M ${jx.toFixed(1)} ${jy.toFixed(1)} Q ${(jx - 20).toFixed(1)} ${(jy - 6).toFixed(1)} ${(jx - 42).toFixed(1)} ${(jy - 24).toFixed(1)}"/>` +
                   `<path class="bn-jin" d="M ${(jx - 26).toFixed(1)} ${(jy - 13).toFixed(1)} l -11 -9"/>`;
      }
      // 90: a songbird perched in the canopy.
      if (count >= 90) {
        const bx0 = apex[0] + 20, by0 = apex[1] - 1;
        accents += `<g class="bn-songbird">` +
          `<path class="bn-bird" d="M ${(bx0 + 5).toFixed(1)} ${by0} l 13 4 l -10 3 Z"/>` +
          `<ellipse class="bn-bird" cx="${bx0}" cy="${by0}" rx="7.5" ry="5"/>` +
          `<circle class="bn-bird" cx="${(bx0 - 6).toFixed(1)}" cy="${(by0 - 4).toFixed(1)}" r="4.2"/>` +
          `<ellipse class="bn-bird-breast" cx="${(bx0 - 4).toFixed(1)}" cy="${(by0 + 1.5).toFixed(1)}" rx="4" ry="4"/>` +
          `<path class="bn-beak" d="M ${(bx0 - 10).toFixed(1)} ${(by0 - 4).toFixed(1)} l -5 1.6 l 4.4 1.6 Z"/>` +
          `<circle class="bn-eye" cx="${(bx0 - 7).toFixed(1)}" cy="${(by0 - 5).toFixed(1)}" r="1"/>` +
          `</g>`;
      }
      // 100: a butterfly visiting the finished masterpiece.
      if (count >= 100) {
        const fx = cx - 90, fy = apex[1] - 2;
        accents += `<g class="bn-flutter">` +
          `<ellipse class="bn-fly-w" cx="${fx - 5}" cy="${fy - 4}" rx="6" ry="8" transform="rotate(-25 ${fx - 5} ${fy - 4})"/>` +
          `<ellipse class="bn-fly-w" cx="${fx + 5}" cy="${fy - 4}" rx="6" ry="8" transform="rotate(25 ${fx + 5} ${fy - 4})"/>` +
          `<ellipse class="bn-fly-w2" cx="${fx - 4}" cy="${fy + 5}" rx="4.5" ry="5.5" transform="rotate(-30 ${fx - 4} ${fy + 5})"/>` +
          `<ellipse class="bn-fly-w2" cx="${fx + 4}" cy="${fy + 5}" rx="4.5" ry="5.5" transform="rotate(30 ${fx + 4} ${fy + 5})"/>` +
          `<rect class="bn-fly-b" x="${fx - 0.8}" y="${fy - 8}" width="1.6" height="16" rx="0.8"/>` +
          `</g>`;
      }
    }

    // --- Pot & soil milestones. Glaze at 60, gilded rim at 70. ---
    const glazed = count >= 60;
    const potCls = glazed ? 'bn-pot bn-pot-glaze' : 'bn-pot';
    const rimCls = glazed ? 'bn-pot-rim bn-rim-glaze' : 'bn-pot-rim';
    const rimTop = soilY + 2, rimH = 12, bodyTop = rimTop + rimH, bodyBot = bodyTop + 26;
    let soilDeco = '';
    // 10: moss mounds.
    if (count >= 10) {
      for (let i = 0; i < 5; i++) {
        const mx = cx + (rnd(i * 31) - 0.5) * 120, my = rimTop + 1 + (rnd(i * 37) - 0.5) * 4;
        soilDeco += `<ellipse class="bn-moss" cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" rx="${(6 + rnd(i * 41) * 7).toFixed(1)}" ry="3"/>`;
      }
    }
    // 30: companion stone.
    if (count >= 30) {
      const sx = cx + 50;
      soilDeco += `<path class="bn-stone" d="M ${sx - 16} ${rimTop + 2} Q ${sx - 18} ${rimTop - 9} ${sx - 4} ${rimTop - 11} Q ${sx + 12} ${rimTop - 13} ${sx + 16} ${rimTop - 3} Q ${sx + 18} ${rimTop + 2} ${sx} ${rimTop + 3} Z"/>`;
    }
    // 50: fallen petals on the soil.
    if (count >= 50) {
      for (let i = 0; i < 9; i++) {
        const px2 = cx + (rnd(i * 53) - 0.5) * 132, py2 = rimTop + 1 + (rnd(i * 59) - 0.5) * 5;
        soilDeco += `<ellipse class="bn-petal" cx="${px2.toFixed(1)}" cy="${py2.toFixed(1)}" rx="2.6" ry="1.6"/>`;
      }
    }
    // 80: an accent grass tuft (left of the trunk).
    if (count >= 80) {
      const gx = cx - 52;
      for (let i = 0; i < 5; i++) {
        const bx2 = gx + (i - 2) * 3, h = 12 + rnd(i * 61) * 7, sway = (rnd(i * 67) - 0.5) * 9;
        soilDeco += `<path class="bn-grass" d="M ${bx2.toFixed(1)} ${rimTop + 2} Q ${(bx2 + sway).toFixed(1)} ${(rimTop + 2 - h * 0.6).toFixed(1)} ${(bx2 + sway * 1.7).toFixed(1)} ${(rimTop + 2 - h).toFixed(1)}"/>`;
      }
    }
    // 70: gilded rim line.
    const rimLine = count >= 70 ? `<rect class="bn-rim-line" x="${cx - 80}" y="${rimTop + 3}" width="160" height="2" rx="1"/>` : '';
    return `<svg class="plant" viewBox="0 0 ${W} ${H}" aria-label="Bonsai shaped by ${count} ${count === 1 ? 'workout' : 'workouts'}">
        <rect class="bn-foot" x="${cx - 54}" y="${bodyBot}" width="15" height="9" rx="2"/>
        <rect class="bn-foot" x="${cx + 39}" y="${bodyBot}" width="15" height="9" rx="2"/>
        <path class="${potCls}" d="M ${cx - 75} ${bodyTop} L ${cx + 75} ${bodyTop} L ${cx + 64} ${bodyBot} L ${cx - 64} ${bodyBot} Z"/>
        <rect class="${rimCls}" x="${cx - 82}" y="${rimTop}" width="164" height="${rimH}" rx="3"/>${rimLine}
        <ellipse class="bn-soil" cx="${cx}" cy="${rimTop + 1}" rx="74" ry="6"/>${soilDeco}
        <g class="pl-plant">${roots}${trunk}${branches}${pads}${accents}</g>
      </svg>`;
  }

  // A milestone every 10 workouts; the caption names the latest unlock and the next one.
  const PLANT_MS = [
    [10, 'moss at the base'], [20, 'canopy blossoms'], [30, 'a companion stone'],
    [40, 'deadwood character'], [50, 'fallen petals'], [60, 'a glazed pot'],
    [70, 'a gilded rim'], [80, 'an accent grass tuft'], [90, 'a perched songbird'],
    [100, 'a visiting butterfly'],
  ];
  function plantCaption(count) {
    const reached = PLANT_MS.filter(([n]) => count >= n);
    const next = PLANT_MS.find(([n]) => count < n);
    if (count === 0) return 'A bare sapling — finish a workout to begin shaping your bonsai.';
    if (count >= 100) return `${plural(count, 'workout')} — your bonsai is a finished masterpiece. 🦋`;
    if (!reached.length) return `${plural(count, 'workout')} — first milestone (moss) at 10. 🌱`;
    return `${plural(count, 'workout')}. Latest: ${reached[reached.length - 1][1]}. Next at ${next[0]}: ${next[1]}.`;
  }

  const plantCount = () => plantPreview !== null ? plantPreview : DB.getSessions().length;
  const plantPreviewLabel = (count) => `Preview · ${count === 0 ? 'sapling' : plural(count, 'workout')}`;
  function plantControls() {
    if (plantPreview === null)
      return `<button class="ghost-btn small" data-action="plant-preview">👁 Preview milestones</button>`;
    const idx = PLANT_PHASES.indexOf(plantPreview);
    return `
      <div class="plant-preview-bar">
        <button class="step" data-action="plant-prev" ${idx <= 0 ? 'disabled' : ''} aria-label="Previous phase">◀</button>
        <span class="plant-preview-label">${esc(plantPreviewLabel(plantPreview))}</span>
        <button class="step" data-action="plant-next" ${idx >= PLANT_PHASES.length - 1 ? 'disabled' : ''} aria-label="Next phase">▶</button>
      </div>
      <button class="ghost-btn small" data-action="plant-exit">Exit preview</button>`;
  }

  function renderPlant() {
    const count = plantCount();
    return `
      <header class="hdr"><h1>Your bonsai</h1>
        <div class="hdr-sub">Shaped by every finished workout</div></header>
      <div class="plant-wrap${plantPreview !== null ? ' previewing' : ''}">
        ${plantSVG(count)}
        <div class="plant-cap">${esc(plantCaption(count))}</div>
        <div class="plant-controls">${plantControls()}</div>
      </div>`;
  }

  // Targeted in-place update for preview stepping — avoids a full content re-render
  // (which would destroy the just-tapped control and re-create the animated SVG on
  // every tap, pegging the renderer on mobile). Mirrors replacePull()/replaceAcc().
  // rebuildControls=true only when the control layout itself changes (enter/exit).
  function paintPlant(rebuildControls) {
    const wrap = content.querySelector('.plant-wrap'); if (!wrap) return;
    const count = plantCount();
    wrap.classList.toggle('previewing', plantPreview !== null);
    const svg = wrap.querySelector('svg.plant'); if (svg) svg.outerHTML = plantSVG(count);
    const cap = wrap.querySelector('.plant-cap'); if (cap) cap.textContent = plantCaption(count);
    if (rebuildControls) {
      const ctrl = wrap.querySelector('.plant-controls'); if (ctrl) ctrl.innerHTML = plantControls();
    } else {
      const label = wrap.querySelector('.plant-preview-label'); if (label) label.textContent = plantPreviewLabel(count);
      const idx = PLANT_PHASES.indexOf(count);
      const prev = wrap.querySelector('[data-action="plant-prev"]'); if (prev) prev.disabled = idx <= 0;
      const next = wrap.querySelector('[data-action="plant-next"]'); if (next) next.disabled = idx >= PLANT_PHASES.length - 1;
    }
  }

  /* ---------------- HISTORY view ---------------- */
  let openSession = null;
  function renderHistory() {
    const sessions = DB.getSessions();
    if (!sessions.length)
      return `<header class="hdr"><h1>History</h1></header><div class="dim center pad">No finished workouts yet.</div>`;
    const items = sessions.map(s => {
      const open = openSession === s.id;
      const pull = `${s.pullups.done} × ${s.pullups.targetReps}`;
      const nEx = s.entries.filter(e => e.done > 0).length;
      const body = open ? `<div class="sess-body">
          <div class="row-line"><b>Pull-ups</b><span>${pull}${DB.pullupsComplete(s) ? ' ✓' : ''}</span></div>
          ${s.entries.filter(e => e.done > 0).map(e =>
            `<div class="row-line"><b>${esc(e.name)}</b><span>${esc(accSessionSummary(e))}</span></div>`).join('')}
          <button class="ghost-btn danger small" data-action="delete-session" data-id="${s.id}">Delete</button>
        </div>` : '';
      return `<div class="card sess ${open ? 'open' : ''}">
          <div class="sess-head" data-action="toggle-session" data-id="${s.id}">
            <div><div class="card-title">${esc(dayName(s.day))} · ${esc(fmtDate(s.date))}</div>
              <div class="dim small">Pull-ups ${pull} · ${plural(nEx, 'exercise')}</div></div>
            <span class="chev">${open ? '▾' : '▸'}</span>
          </div>${body}</div>`;
    }).join('');
    return `<header class="hdr"><h1>History</h1></header><div class="list">${items}</div>`;
  }

  /* ---------------- PROGRAM view ---------------- */
  function renderProgram() {
    const p = DB.getProgram();
    const n = DB.exerciseCountForSets(p.sets);
    const dayList = (day) => `<div class="prog-list" data-day="${day}">${
      DB.getExercisesByDay(day).map((e, i) => `
      <div class="prog-row ${i < n ? '' : 'prog-dim'}" data-id="${e.id}">
        <span class="drag-handle" aria-label="Drag to reorder">≡</span>
        <div class="prog-info"><b>${esc(e.name) || '(unnamed)'}</b>
          <span class="dim small">${e.bodyweight ? `${e.sets} × ${e.reps} · bodyweight` : `${e.sets} × ${e.reps} @ ${e.weight}${unit()}`}${i < n ? '' : ' · skipped at current level'}</span></div>
        <button class="x-btn" data-action="edit-ex" data-id="${e.id}">Edit</button>
      </div>`).join('') || '<div class="dim small">No exercises.</div>'
    }</div>`;
    return `
      <header class="hdr"><h1>Program</h1></header>
      <div class="card">
        <div class="card-title">Pull-ups</div>
        <div class="dim small">Each completed workout adds ${p.setStep} set up to ${p.maxSets}, then +${p.repStep} rep and back to ${p.minSets}. You do the first ⌊sets ÷ 3⌋ = <b>${n}</b> accessories each workout.</div>
        <div class="stepper-row"><span>Current sets</span>
          <button class="step" data-action="prog-sets-dec">−</button><b class="stepval">${p.sets}</b><button class="step" data-action="prog-sets-inc">+</button></div>
        <div class="stepper-row"><span>Current reps</span>
          <button class="step" data-action="prog-reps-dec">−</button><b class="stepval">${p.reps}</b><button class="step" data-action="prog-reps-inc">+</button></div>
        <div class="cfg-block">
          <div class="cfg-title">Progression rule</div>
          <label class="field row-field"><span>Min sets</span><input type="number" min="1" step="1" data-action="cfg-minSets" value="${p.minSets}"></label>
          <label class="field row-field"><span>Max sets</span><input type="number" min="1" step="1" data-action="cfg-maxSets" value="${p.maxSets}"></label>
          <label class="field row-field"><span>Rep increment</span><input type="number" min="1" step="1" data-action="cfg-repStep" value="${p.repStep}"></label>
        </div>
      </div>
      <div class="card">
        <div class="card-title">Push day <span class="dim small">chest · shoulders · tricep</span></div>
        ${dayList('push')}
        <button class="add-row-btn" data-action="add-ex" data-day="push">＋ Add push exercise</button>
      </div>
      <div class="card">
        <div class="card-title">Leg day</div>
        ${dayList('leg')}
        <button class="add-row-btn" data-action="add-ex" data-day="leg">＋ Add leg exercise</button>
      </div>
      <div class="dim center small">Drag ≡ to reorder. Order = priority; the first ${n} are done on a ${p.sets}-set day.</div>`;
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
        <option value="push" ${e.day === 'push' ? 'selected' : ''}>Push day</option>
        <option value="leg" ${e.day === 'leg' ? 'selected' : ''}>Leg day</option></select></label>
      <label class="field"><span>Type</span><select id="ed-type">
        <option value="weight" ${!e.bodyweight ? 'selected' : ''}>Weighted</option>
        <option value="bw" ${e.bodyweight ? 'selected' : ''}>Bodyweight</option></select></label>
      <div class="ed-grid">
        <label class="field"><span>Sets</span><input id="ed-sets" type="number" min="1" step="1" value="${e.sets}"></label>
        <label class="field"><span>Reps</span><input id="ed-reps" type="number" min="1" step="1" value="${e.reps}"></label>
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
      <div class="dim center small pad">Augie Swole · offline-first · v3</div>`;
  }

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

      case 'pull-inc': withActive(x => { if (x.pullups.done < x.pullups.targetSets) x.pullups.done += 1; }); haptic(10); replacePull(); break;
      case 'pull-dec': withActive(x => { x.pullups.done = Math.max(0, x.pullups.done - 1); }); replacePull(); break;

      case 'acc-inc': withActive(x => { const en = x.entries[e]; if (en.done < en.targetSets) en.done += 1; }); haptic(10); replaceAcc(e); break;
      case 'acc-dec': withActive(x => { const en = x.entries[e]; en.done = Math.max(0, en.done - 1); }); replaceAcc(e); break;
      case 'acc-next-bump': withActive(x => { const en = x.entries[e]; const cur = (typeof en.nextWeight === 'number') ? en.nextWeight : (Number(en.weight) || 0); en.nextWeight = Math.max(0, round(cur + (+t.dataset.d) * weightStep(cur))); }); replaceAcc(e); break;
      case 'acc-now-bump': withActive(x => { const en = x.entries[e]; const cur = Number(en.weight) || 0; en.weight = Math.max(0, round(cur + (+t.dataset.d) * weightStep(cur))); }); replaceAcc(e); break;

      case 'finish': {
        const prog = DB.getProgram();
        const saved = DB.finishActive();
        if (saved) {
          const np = DB.getProgram();
          const advanced = (np.sets !== prog.sets || np.reps !== prog.reps);
          openSession = saved.id; view = 'history'; render();
          if (advanced) alertDialog(`Pull-ups complete! Next workout: ${np.sets} × ${np.reps}.`);
        } else render();
        break;
      }
      case 'discard': confirmDialog('Discard this workout? Nothing will be saved.', () => { DB.discardActive(); render(); }, { confirmText: 'Discard', danger: true }); break;

      case 'toggle-session': openSession = openSession === t.dataset.id ? null : t.dataset.id; render(); break;
      case 'delete-session': { const id = t.dataset.id; confirmDialog('Delete this workout from history?', () => { DB.deleteSession(id); render(); }, { confirmText: 'Delete', danger: true }); break; }

      case 'prog-sets-dec': adjustProg('sets', -1); break;
      case 'prog-sets-inc': adjustProg('sets', 1); break;
      case 'prog-reps-dec': adjustProg('reps', -1); break;
      case 'prog-reps-inc': adjustProg('reps', 1); break;
      case 'add-ex': openEditor(DB.newExercise(t.dataset.day)); break;
      case 'edit-ex': { const ex = DB.getExercise(t.dataset.id); if (ex) openEditor(ex); break; }

      case 'plant-preview': { const cur = Math.min(DB.getSessions().length, 100); plantPreview = PLANT_PHASES.filter(n => n <= cur).pop() ?? 0; paintPlant(true); break; }
      case 'plant-prev': { const i = PLANT_PHASES.indexOf(plantPreview); if (i > 0) { plantPreview = PLANT_PHASES[i - 1]; paintPlant(false); } break; }
      case 'plant-next': { const i = PLANT_PHASES.indexOf(plantPreview); if (i < PLANT_PHASES.length - 1) { plantPreview = PLANT_PHASES[i + 1]; paintPlant(false); } break; }
      case 'plant-exit': plantPreview = null; paintPlant(true); break;

      case 'export': doExport(); break;
      case 'import': document.getElementById('import-file').click(); break;
      case 'clear': confirmDialog('Erase ALL data on this device? This cannot be undone.', () =>
        confirmDialog('Really erase everything?', () => { DB.clearAll(); DB.seedIfEmpty(); openSession = null; view = 'workout'; render(); }, { confirmText: 'Erase everything', danger: true }),
        { confirmText: 'Continue', danger: true }); break;
    }
  });

  function adjustProg(field, delta) { const p = DB.getProgram(); p[field] = Math.max(1, p[field] + delta); DB.saveProgram(p); render(); }

  /* ---------------- changes ---------------- */
  content.addEventListener('change', (ev) => {
    const t = ev.target.closest('[data-action]'); if (!t) return;
    const act = t.dataset.action;
    if (act === 'acc-next') withActive(x => { x.entries[+t.dataset.e].nextWeight = Math.max(0, Number(t.value) || 0); });
    else if (act === 'acc-now') withActive(x => { x.entries[+t.dataset.e].weight = Math.max(0, Number(t.value) || 0); });
    else if (act === 'save-unit') { const s = DB.getSettings(); s.unit = t.value; DB.saveSettings(s); }
    else if (act === 'cfg-minSets' || act === 'cfg-maxSets' || act === 'cfg-repStep') {
      const prog = DB.getProgram(); prog[act.slice(4)] = Math.max(1, parseInt(t.value, 10) || 1); DB.saveProgram(prog); render();
    }
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
  tabbar.addEventListener('click', (ev) => { const b = ev.target.closest('.tab'); if (!b) return; view = b.dataset.tab; plantPreview = null; render(); });

  content.addEventListener('scroll', hideChartTip, { passive: true });

  DB.seedIfEmpty();
  render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

/* app.js — RepLog UI. Vanilla JS, no framework, no build step. */
(() => {
  'use strict';

  const content = document.getElementById('content');
  const tabbar = document.getElementById('tabbar');
  let view = 'workout';

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
    if (view === 'workout') content.innerHTML = renderWorkout();
    if (view === 'stats') content.innerHTML = renderStats();
    if (view === 'plant') content.innerHTML = renderPlant();
    if (view === 'history') content.innerHTML = renderHistory();
    if (view === 'program') content.innerHTML = renderProgram();
    if (view === 'backup') content.innerHTML = renderBackup();
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
      <header class="hdr"><h1>RepLog</h1>
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

  /* ---------------- PLANT view (one leaf per finished workout) ---------------- */
  function plantSVG(count) {
    const W = 300, H = 360, cx = 150, soilY = 300;
    const rnd = (i) => { const x = Math.sin((i + 1) * 12.9898) * 43758.5453; return x - Math.floor(x); };
    const stemH = count === 0 ? 24 : Math.min(240, 36 + count * 14);
    const topY = soilY - stemH;
    const stem = `<path class="pl-stem" d="M ${cx} ${soilY} C ${cx - 10} ${(soilY - stemH * 0.45).toFixed(1)}, ${cx + 10} ${(soilY - stemH * 0.72).toFixed(1)}, ${cx} ${topY.toFixed(1)}"/>`;
    let leaves = '';
    for (let i = 0; i < count; i++) {
      const t = (i + 0.6) / (count + 0.3);
      const y = soilY - t * stemH - 4;
      const side = (i % 2 === 0) ? -1 : 1;
      const j = rnd(i) - 0.5;
      const theta = -90 + side * ((1 - t) * 46 + 14) + j * 14;
      const L = 30 + (1 - t) * 22 + j * 5, w = L * 0.5;
      const leaf = `M0,0 Q ${(L * 0.5).toFixed(1)} ${(-w).toFixed(1)} ${L.toFixed(1)} 0 Q ${(L * 0.5).toFixed(1)} ${w.toFixed(1)} 0 0 Z`;
      leaves += `<g transform="translate(${cx} ${y.toFixed(1)}) rotate(${theta.toFixed(1)})"><path class="${i % 2 ? 'pl-leaf-b' : 'pl-leaf-a'}" d="${leaf}"/><path class="pl-vein" d="M2 0 L ${(L - 3).toFixed(1)} 0"/></g>`;
    }
    const tip = count === 0
      ? `<g transform="translate(${cx} ${topY})"><path class="pl-leaf-a" d="M0,0 Q 7 -10 14 0 Q 7 8 0 0 Z" transform="rotate(-120)"/><path class="pl-leaf-b" d="M0,0 Q 7 -10 14 0 Q 7 8 0 0 Z" transform="rotate(-55)"/></g>`
      : `<circle class="pl-bud" cx="${cx}" cy="${topY.toFixed(1)}" r="5.5"/>`;
    return `<svg class="plant" viewBox="0 0 ${W} ${H}" aria-label="Plant with ${count} ${count === 1 ? 'leaf' : 'leaves'}">
        <path class="pl-pot" d="M ${cx - 46} ${soilY} L ${cx + 46} ${soilY} L ${cx + 36} ${soilY + 58} L ${cx - 36} ${soilY + 58} Z"/>
        <path class="pl-soil" d="M ${cx - 44} ${soilY - 1} h 88 v 7 h -88 Z"/>
        <g class="pl-plant">${stem}${leaves}${tip}</g>
        <rect class="pl-pot-rim" x="${cx - 50}" y="${soilY - 10}" width="100" height="14" rx="3"/>
      </svg>`;
  }

  function renderPlant() {
    const count = DB.getSessions().length;
    const leafTxt = `${count} ${count === 1 ? 'leaf' : 'leaves'}`;
    const mood = count >= 25 ? 'A whole bush. 🌳' : count >= 12 ? "It's getting bushy. 🌿" : count >= 1 ? 'Keep it growing. 🌱' : '';
    const caption = count === 0
      ? 'Bare for now — finish a workout to sprout your first leaf.'
      : `${plural(count, 'workout')} → ${leafTxt}. ${mood}`;
    return `
      <header class="hdr"><h1>Your plant</h1>
        <div class="hdr-sub">One leaf per finished workout</div></header>
      <div class="plant-wrap">
        ${plantSVG(count)}
        <div class="plant-cap">${esc(caption)}</div>
      </div>`;
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
      <div class="dim center small pad">RepLog · offline-first · v3</div>`;
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
    if (act === 'acc-next') withActive(x => { x.entries[+t.dataset.e].nextWeight = t.value === '' ? 0 : Number(t.value); });
    else if (act === 'acc-now') withActive(x => { x.entries[+t.dataset.e].weight = t.value === '' ? 0 : Number(t.value); });
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
  });

  function doExport() {
    const blob = new Blob([JSON.stringify(DB.exportAll(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `replog-backup-${new Date().toISOString().slice(0, 10)}.json`;
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
  tabbar.addEventListener('click', (ev) => { const b = ev.target.closest('.tab'); if (!b) return; view = b.dataset.tab; render(); });

  content.addEventListener('scroll', hideChartTip, { passive: true });

  DB.seedIfEmpty();
  render();
  if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
})();

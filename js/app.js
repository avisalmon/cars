(() => {
  'use strict';

  const DATA_URL = 'data/cars-israel.json';
  const LS_WEIGHTS = 'cars-il.weights';
  const LS_ASSUMPTIONS = 'cars-il.assumptions';
  const LS_THEME = 'cars-il.theme';
  const LS_PROFILE = 'cars-il.profile';

  const HORIZON = 5;

  const state = {
    meta: {}, criteria: [], cars: [], quoteOnly: [], dealers: {}, dealerNote: '', images: {},
    sources: [], limitations: [], timeline: [], profiles: [], comfort: null,
    weights: {}, assumptions: {}, profile: null, weightsCustom: false,
    filters: { search: '', budget: null, maxL100: null, body: new Set(), powertrain: new Set(), make: new Set() },
    sort: 'score'
  };

  const $ = (sel) => document.querySelector(sel);
  const el = (tag, cls, html) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  };
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ------------------------------------------------------------------
     Assumption sliders that drive the live cost model
     ------------------------------------------------------------------ */

  const ASSUMPTION_DEFS = [
    { key: 'kmPerYear',        label: 'Kilometres per year',        min: 5000, max: 40000, step: 1000,   format: (v) => v.toLocaleString('en-US') + ' km' },
    { key: 'petrolPrice',      label: 'Petrol (95)',                min: 5,    max: 12,    step: 0.01,   format: (v) => '₪' + v.toFixed(2) + '/L' },
    { key: 'electricityPrice', label: 'Home electricity',           min: 0.2,  max: 1.5,   step: 0.0001, format: (v) => '₪' + v.toFixed(4) + '/kWh' },
    { key: 'phevEvShare',      label: 'PHEV driven on electricity', min: 0,    max: 1,     step: 0.05,   format: (v) => Math.round(v * 100) + '%' }
  ];

  /* ------------------------------------------------------------------
     Cost model
     ------------------------------------------------------------------ */

  function energyCost(car, a) {
    const totalKm = a.kmPerYear * HORIZON;
    const f = car.fuel || {};
    if (f.kwh100 != null) {
      const evKm = totalKm * a.phevEvShare;
      const petrolKm = totalKm - evKm;
      return (evKm / 100) * f.kwh100 * a.electricityPrice
           + (petrolKm / 100) * f.l100 * a.petrolPrice;
    }
    if (f.l100 == null) return null;
    return (totalKm / 100) * f.l100 * a.petrolPrice;
  }

  function midDiscount(car) {
    const d = car.discountTarget;
    return Array.isArray(d) && d.length === 2 ? (d[0] + d[1]) / 2 : 0;
  }

  /* ------------------------------------------------------------------
     Comfort proxy

     The research contains no comfort rating, so nothing here is a comfort
     score from a source. This is a transparent composite of four published
     specs — boot litres, seats, power and body class — normalised across
     the whole fleet once, so the number does not move when you filter.

     It measures SIZE AND SPACE, not ride quality, seat shape or cabin
     noise. Where the research states a comfort verdict that disagrees with
     the number, that verdict is attached to the value as a note.
     ------------------------------------------------------------------ */

  // Body class is the one component that is a judgement rather than a
  // published figure: a tier for how much cabin a class typically gives.
  const BODY_CLASS = { 'Sedan': 0.50, 'SUV': 0.75, '3-row SUV': 1.00 };
  const COMFORT_PARTS = { cargo: 0.30, seats: 0.30, power: 0.20, body: 0.20 };
  const COMFORT_MIN_PARTS = 3;
  const TABLE_COLS = 7;

  function computeComfort(cars) {
    const span = (key) => {
      const v = cars.map((c) => c[key]).filter((x) => typeof x === 'number');
      return v.length ? [Math.min(...v), Math.max(...v)] : null;
    };
    const spans = { cargo: span('cargo'), seats: span('seats'), power: span('power') };
    const unit = (value, s) => {
      if (typeof value !== 'number' || !s) return null;
      const [lo, hi] = s;
      return hi === lo ? 1 : (value - lo) / (hi - lo);
    };

    const out = {};
    cars.forEach((car) => {
      const parts = {
        cargo: unit(car.cargo, spans.cargo),
        seats: unit(car.seats, spans.seats),
        power: unit(car.power, spans.power),
        body: BODY_CLASS[car.body] != null ? BODY_CLASS[car.body] : null
      };
      const have = Object.keys(parts).filter((k) => parts[k] != null);
      // Too little published data is reported as unknown, never as zero.
      if (have.length < COMFORT_MIN_PARTS) { out[car.id] = null; return; }
      // Re-weight over what exists so a missing spec does not read as bad.
      const total = have.reduce((s, k) => s + COMFORT_PARTS[k], 0);
      out[car.id] = Math.round(have.reduce((s, k) => s + parts[k] * COMFORT_PARTS[k], 0) / total * 100);
    });
    return out;
  }

  // Resale is set by the market, not by your invoice, so a negotiated
  // discount reduces economic cost roughly shekel-for-shekel.
  function computeDerived(car, a) {
    const discount = a.applyDiscount ? midDiscount(car) : 0;
    const paid = car.msrp - discount;
    const residualValue = car.msrp * car.residual;
    const depreciation = paid - residualValue;
    const energy5 = energyCost(car, a);
    const tco5 = depreciation + car.fees5 + car.insurance5 + (energy5 || 0) + car.maint5;

    return Object.assign({}, car, {
      discount, residualValue, depreciation, energy5, tco5,
      comfortProxy: state.comfort ? state.comfort[car.id] : null,
      acquisition: paid + car.registration,
      costParts: [
        { label: 'Depreciation', value: depreciation },
        { label: 'Registration & fees', value: car.fees5 },
        { label: 'Insurance', value: car.insurance5 },
        { label: 'Energy', value: energy5 || 0 },
        { label: 'Maintenance', value: car.maint5 }
      ]
    });
  }

  /* ------------------------------------------------------------------
     Scoring: min-max normalise across the visible set, then weighted mean
     ------------------------------------------------------------------ */

  function scoreCars(cars) {
    const ranges = {};
    state.criteria.forEach((c) => {
      const vals = cars.map((car) => car[c.key]).filter((v) => typeof v === 'number' && isFinite(v));
      ranges[c.key] = vals.length ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
    });

    return cars.map((car) => {
      const parts = [];
      let weighted = 0, totalWeight = 0;

      state.criteria.forEach((c) => {
        const weight = state.weights[c.key] ?? 0;
        const range = ranges[c.key];
        const raw = car[c.key];
        if (!range || typeof raw !== 'number' || !isFinite(raw)) return;

        const span = range.max - range.min;
        let norm = span === 0 ? 1 : (raw - range.min) / span;
        if (c.direction === 'lower') norm = 1 - norm;
        const points = norm * 100;

        parts.push({ key: c.key, label: c.label, points, weight });
        if (weight > 0) { weighted += points * weight; totalWeight += weight; }
      });

      return Object.assign({}, car, {
        score: totalWeight > 0 ? weighted / totalWeight : 0,
        scoreParts: parts
      });
    });
  }

  /* ------------------------------------------------------------------
     Formatting
     ------------------------------------------------------------------ */

  const cur = () => state.meta.currency || '₪';
  const money = (v) => (v == null || !isFinite(v)) ? '—' : cur() + Math.round(v).toLocaleString('en-US');
  const moneyK = (v) => (v == null || !isFinite(v)) ? '—' : cur() + (Math.round(v / 100) / 10).toFixed(1) + 'k';

  function fmt(value, criterion) {
    if (value == null || !isFinite(value)) return '—';
    switch (criterion.format) {
      case 'currency': return money(value);
      case 'percent':  return Math.round(value * 100) + '%';
      case 'score':    return value.toFixed(1);
      case 'l100':     return value.toFixed(1);
      case 'litres':   return Math.round(value).toLocaleString('en-US') + ' L';
      case 'index':    return Math.round(value) + ' / 100';
      case 'hp':       return Math.round(value) + ' hp';
      default:         return String(value);
    }
  }

  const isEstimated = (car, key) => Array.isArray(car.estimates) && car.estimates.includes(key);
  const fieldNote = (car, key) => (car.fieldNotes && car.fieldNotes[key]) || null;

  function cellValue(car, criterion) {
    const text = fmt(car[criterion.key], criterion);
    const note = fieldNote(car, criterion.key);
    if (text === '—') {
      return `<span class="est" title="${esc(note || 'Not published in the retrieved source — left blank rather than invented')}">—</span>`;
    }
    if (isEstimated(car, criterion.key)) {
      return `<span class="est" title="${esc(note || 'Estimated — not published as an official figure')}">${text}</span>`;
    }
    if (note) return `<span class="est" title="${esc(note)}">${text}</span>`;
    return text;
  }

  /* ------------------------------------------------------------------
     Filtering & sorting
     ------------------------------------------------------------------ */

  function excludedPowertrains() {
    const p = activeProfile();
    return new Set(p && Array.isArray(p.excludePowertrain) ? p.excludePowertrain : []);
  }

  function applyFilters(cars) {
    const { search, budget, maxL100, body, powertrain, make } = state.filters;
    const needle = search.trim().toLowerCase();
    const excluded = excludedPowertrains();
    const profile = activeProfile();
    const minCargo = profile && profile.minCargo != null ? profile.minCargo : null;

    return cars.filter((car) => {
      if (excluded.has(car.powertrain)) return false;
      // A null cargo figure fails a cargo floor: unknown is not the same as big enough.
      if (minCargo != null && !(typeof car.cargo === 'number' && car.cargo >= minCargo)) return false;
      if (budget != null && car.acquisition > budget) return false;
      // Filter on the modeled figure, which is what the costs actually use.
      if (maxL100 != null && car.fuel && typeof car.fuel.l100 === 'number' && car.fuel.l100 > maxL100) return false;
      if (body.size && !body.has(car.body)) return false;
      if (powertrain.size && !powertrain.has(car.powertrain)) return false;
      if (make.size && !make.has(car.make)) return false;
      if (needle) {
        const hay = [car.make, car.model, car.body, car.powertrain, car.notes, car.bestFor]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
  }

  // Missing values always sink to the bottom, whichever way we're sorting.
  function byNumber(key, dir) {
    return (a, b) => {
      const av = a[key], bv = b[key];
      const aBad = av == null || !isFinite(av);
      const bBad = bv == null || !isFinite(bv);
      if (aBad && bBad) return 0;
      if (aBad) return 1;
      if (bBad) return -1;
      return dir === 'desc' ? bv - av : av - bv;
    };
  }

  function sortCars(cars) {
    const out = cars.slice();
    switch (state.sort) {
      case 'tco5':        out.sort(byNumber('tco5', 'asc')); break;
      case 'acquisition': out.sort(byNumber('acquisition', 'asc')); break;
      case 'consumption': out.sort(byNumber('consumption', 'asc')); break;
      case 'cargo':       out.sort(byNumber('cargo', 'desc')); break;
      case 'name':        out.sort((a, b) => (a.make + a.model).localeCompare(b.make + b.model)); break;
      default:            out.sort(byNumber('score', 'desc'));
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Controls
     ------------------------------------------------------------------ */

  const saveWeights = () => { try { localStorage.setItem(LS_WEIGHTS, JSON.stringify(state.weights)); } catch (_) {} };
  const saveAssumptions = () => { try { localStorage.setItem(LS_ASSUMPTIONS, JSON.stringify(state.assumptions)); } catch (_) {} };
  const saveProfile = () => { try { localStorage.setItem(LS_PROFILE, state.profile || ''); } catch (_) {} };

  const activeProfile = () => state.profiles.find((p) => p.id === state.profile) || null;

  // A profile owns two separate things: which powertrains are in scope (sticky —
  // it is the category you chose) and a starting weight mix (freely adjustable).
  // Nudging a slider must not quietly put an excluded powertrain back in the list.
  function selectProfile(id) {
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) return;
    state.profile = id;
    state.weightsCustom = false;
    state.weights = Object.assign({}, profile.weights);
    saveProfile();
    saveWeights();
    renderProfiles();
    renderWeights();
    render();
  }

  function renderProfiles() {
    const host = $('#profiles');
    if (!host) return;
    const active = activeProfile();

    host.innerHTML = state.profiles.map((p) => `
      <button class="profile-btn${p.id === state.profile ? ' active' : ''}" type="button" data-profile="${esc(p.id)}"
              aria-pressed="${p.id === state.profile ? 'true' : 'false'}">
        <span class="profile-label">${esc(p.label)}</span>
        <span class="profile-tagline">${esc(p.tagline)}</span>
        ${p.excludePowertrain && p.excludePowertrain.length
          ? `<span class="profile-excl">${esc(p.excludePowertrain.join(', '))} excluded</span>` : ''}
        ${p.minCargo != null ? `<span class="profile-excl">Needs ${p.minCargo} L+ boot</span>` : ''}
        ${p.id === state.profile && state.weightsCustom
          ? '<span class="profile-custom">Weights adjusted — press Reset to restore</span>' : ''}
      </button>`).join('');

    host.querySelectorAll('button[data-profile]').forEach((btn) => {
      btn.addEventListener('click', () => selectProfile(btn.dataset.profile));
    });

    $('#profile-note').textContent = active ? active.note : '';
    $('#profile-note').hidden = !active;
  }

  function markCustomWeights() {
    const p = activeProfile();
    if (!p) return;
    const custom = !Object.keys(p.weights).every((k) => (state.weights[k] ?? 0) === p.weights[k]);
    if (custom !== state.weightsCustom) {
      state.weightsCustom = custom;
      renderProfiles();
    }
  }

  function renderWeights() {
    const host = $('#weights');
    host.innerHTML = '';
    state.criteria.forEach((c) => {
      const w = state.weights[c.key] ?? 0;
      const row = el('div', 'slider-row' + (w === 0 ? ' off' : ''));
      row.innerHTML = `
        <div class="slider-head">
          <label for="w-${c.key}" title="${esc(c.hint)}">${esc(c.label)}</label>
          <b>${w}</b>
        </div>
        <input type="range" id="w-${c.key}" min="0" max="10" step="1" value="${w}"
               aria-label="${esc(c.label)} importance">`;
      row.querySelector('input').addEventListener('input', (e) => {
        const v = Number(e.target.value);
        state.weights[c.key] = v;
        row.querySelector('b').textContent = v;
        row.classList.toggle('off', v === 0);
        saveWeights();
        markCustomWeights();
        render();
      });
      host.appendChild(row);
    });
  }

  function renderAssumptions() {
    const host = $('#assumptions');
    host.innerHTML = '';
    ASSUMPTION_DEFS.forEach((def) => {
      const note = (state.meta.assumptionNotes || {})[def.key] || '';
      const row = el('div', 'slider-row');
      row.innerHTML = `
        <div class="slider-head">
          <label for="a-${def.key}" title="${esc(note)}">${esc(def.label)}</label>
          <b>${def.format(state.assumptions[def.key])}</b>
        </div>
        <input type="range" id="a-${def.key}" min="${def.min}" max="${def.max}" step="${def.step}"
               value="${state.assumptions[def.key]}" aria-label="${esc(def.label)}">`;
      row.querySelector('input').addEventListener('input', (e) => {
        state.assumptions[def.key] = Number(e.target.value);
        row.querySelector('b').textContent = def.format(state.assumptions[def.key]);
        saveAssumptions();
        render();
      });
      host.appendChild(row);
    });
  }

  function renderChips(hostSel, values, set) {
    const host = $(hostSel);
    host.innerHTML = '';
    values.forEach((value) => {
      const btn = el('button', 'chip');
      btn.type = 'button';
      btn.textContent = value;
      btn.setAttribute('aria-pressed', set.has(value) ? 'true' : 'false');
      btn.addEventListener('click', () => {
        if (set.has(value)) set.delete(value); else set.add(value);
        btn.setAttribute('aria-pressed', set.has(value) ? 'true' : 'false');
        render();
      });
      host.appendChild(btn);
    });
  }

  /* ------------------------------------------------------------------
     Output
     ------------------------------------------------------------------ */

  function renderTableHead() {
    const cols = state.criteria.slice(0, TABLE_COLS);
    $('#cars-head').innerHTML = '<tr><th>Car</th><th>Match</th>' +
      cols.map((c) => `<th title="${esc(c.hint)}">${esc(c.short || c.label)}</th>`).join('') + '</tr>';
  }

  function renderTable(cars) {
    const cols = state.criteria.slice(0, TABLE_COLS);
    const body = $('#cars-body');
    body.innerHTML = '';

    if (!cars.length) {
      body.innerHTML = `<tr><td class="empty" colspan="${cols.length + 2}">No cars match these filters.</td></tr>`;
      return;
    }

    cars.forEach((car, i) => {
      const tr = el('tr');
      tr.tabIndex = 0;
      tr.innerHTML = `
        <td>
          <div class="car-cell">
            <span class="rank">${i + 1}</span>
            <span class="car-id">
              <span class="car-name">${esc(car.make)} ${esc(car.model)}</span>
              <span class="car-sub">${esc(car.body)} · ${esc(car.powertrain)} · ${car.seats} seats</span>
            </span>
          </div>
        </td>
        <td>
          <div class="score-cell">
            <span class="score-num">${car.score.toFixed(0)}</span>
            <span class="bar"><i style="width:${Math.max(2, car.score).toFixed(1)}%"></i></span>
          </div>
        </td>
        ${cols.map((c) => `<td>${cellValue(car, c)}</td>`).join('')}`;
      const open = () => openDialog(car);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      body.appendChild(tr);
    });
  }

  function renderVerdict(scored) {
    const host = $('#verdict-cards');
    if (!scored.length) {
      host.innerHTML = '<p class="muted small">Nothing passes the current filters.</p>';
      return;
    }
    host.innerHTML = scored.slice().sort(byNumber('score', 'desc')).slice(0, 3).map((car, i) => `
      <div class="verdict-card ${i === 0 ? 'top' : ''}">
        <div class="verdict-rank">${i === 0 ? 'Best match' : '#' + (i + 1)}</div>
        <div class="verdict-name">${esc(car.make)} ${esc(car.model)}</div>
        <div class="verdict-score">${car.score.toFixed(0)}<span class="of">/100</span></div>
        <div class="verdict-meta">${money(car.acquisition)} cash · ${moneyK(car.tco5)} over 5 yr</div>
      </div>`).join('');
  }

  function dealerBlock(car, compact) {
    const brand = state.dealers[car.make];
    if (!brand) {
      return `<p class="muted small">Haifa-area showrooms for ${esc(car.make)} were not part of the verified dealer research — check the importer's own site.</p>`;
    }
    if (!Array.isArray(brand.showrooms) || !brand.showrooms.length) {
      return `<p class="muted small">
        No Haifa-area address could be verified from ${esc(car.make)}'s official site, so none is listed here rather than guessed.
        ${brand.branchesUrl ? `<a href="${esc(brand.branchesUrl)}" target="_blank" rel="noopener">Dealer locator ↗</a>` : ''}
        ${brand.testDriveUrl ? ` · <a href="${esc(brand.testDriveUrl)}" target="_blank" rel="noopener">Book a test drive ↗</a>` : ''}
      </p>`;
    }
    const shown = compact ? brand.showrooms.slice(0, 2) : brand.showrooms;
    const list = shown.map((s) => `
      <li>
        <div class="dealer-top">
          <strong>${esc(s.name)}</strong>
          ${s.kind ? `<span class="pill ${s.kind.toLowerCase().includes('service') && !s.kind.toLowerCase().includes('sales') ? 'pill-warn' : ''}">${esc(s.kind)}</span>` : ''}
        </div>
        <span class="addr">${esc(s.address)}</span>
        ${s.addressHe ? `<span class="addr he" dir="rtl" lang="he">${esc(s.addressHe)}</span>` : ''}
        ${s.hours ? `<span class="addr">${esc(s.hours)}</span>` : ''}
        <span class="dealer-links">
          ${s.phone ? `<a href="tel:${esc(s.phone.replace(/[^+\d]/g, ''))}">${esc(s.phone)}</a>` : ''}
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(s.mapQuery || s.address)}" target="_blank" rel="noopener">Map ↗</a>
        </span>
      </li>`).join('');

    const more = compact && brand.showrooms.length > shown.length
      ? `<li class="muted more">+ ${brand.showrooms.length - shown.length} more in the detail view</li>` : '';

    return `
      <ul class="dealers">${list}${more}</ul>
      <p class="dealer-foot muted">
        ${brand.importer ? `Imported by ${esc(brand.importer)}. ` : ''}
        ${brand.branchesUrl ? `<a href="${esc(brand.branchesUrl)}" target="_blank" rel="noopener">All branches ↗</a>` : ''}
        ${brand.testDriveUrl ? ` · <a href="${esc(brand.testDriveUrl)}" target="_blank" rel="noopener">Book a test drive ↗</a>` : ''}
      </p>`;
  }

  function renderPicks(scored) {
    const host = $('#pick-cards');
    const top = scored.slice().sort(byNumber('score', 'desc')).slice(0, 6);
    const sub = $('#picks-sub');
    if (sub) {
      const words = ['', 'single', 'two', 'three', 'four', 'five', 'six'];
      sub.textContent = top.length
        ? `The ${words[top.length] || top.length} highest-scoring ${top.length === 1 ? 'car' : 'cars'} under your current priorities — with where to see ${top.length === 1 ? 'it' : 'them'} around Haifa.`
        : 'No cars match your current priorities.';
    }
    if (!top.length) { host.innerHTML = '<p class="muted">No cars match these filters.</p>'; return; }

    host.innerHTML = top.map((car, i) => {
      const img = state.images[car.id];
      const media = img
        ? `<img src="${esc(img.src)}" alt="${esc(car.make)} ${esc(car.model)}" loading="lazy">`
        : `<div class="no-photo"><span>${esc(car.make)}</span><span>${esc(car.model)}</span></div>`;

      return `
        <article class="pick-card">
          <div class="pick-media">
            ${media}
            <span class="pick-rank">#${i + 1}</span>
            <span class="pick-score" title="Match score under your current priorities">${car.score.toFixed(0)}</span>
          </div>
          <div class="pick-body">
            <h3>${esc(car.make)} ${esc(car.model)}</h3>
            <p class="pick-sub muted small">${esc(car.body)} · ${esc(car.powertrain)} · ${car.seats} seats${car.evRange ? ` · ${car.evRange} km EV` : ''}</p>

            <div class="pick-stats">
              <div><span>Cash price</span><b>${money(car.acquisition)}</b></div>
              <div><span>5-year cost</span><b>${moneyK(car.tco5)}</b></div>
              <div><span>Energy / 5 yr</span><b>${moneyK(car.energy5)}</b></div>
            </div>

            <p class="small pick-for">${esc(car.bestFor || '')}</p>

            <div class="pick-links">
              <a class="btn btn-primary" href="${esc(car.link)}" target="_blank" rel="noopener">Official page ↗</a>
              <button class="btn" type="button" data-car="${esc(car.id)}">Full breakdown</button>
            </div>

            <details class="pick-dealers">
              <summary>Where to see it — Haifa area</summary>
              ${dealerBlock(car, true)}
            </details>
          </div>
        </article>`;
    }).join('');

    host.querySelectorAll('button[data-car]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const car = scored.find((c) => c.id === btn.dataset.car);
        if (car) openDialog(car);
      });
    });
  }

  function openDialog(car) {
    const img = state.images[car.id];
    const maxPart = Math.max(...car.costParts.map((p) => p.value));
    const strengths = car.scoreParts.filter((p) => p.weight > 0).sort((a, b) => b.points - a.points);

    $('#car-dialog-content').innerHTML = `
      ${img ? `<img class="dialog-photo" src="${esc(img.src)}" alt="${esc(car.make)} ${esc(car.model)}">` : ''}
      <h3>${esc(car.make)} ${esc(car.model)}</h3>
      <p class="muted small">${esc(car.drivetrain || '')}</p>

      <div class="dialog-grid">
        ${state.criteria.map((c) => `
          <div class="dialog-stat"><span>${esc(c.label)}</span><b>${cellValue(car, c)}</b></div>`).join('')}
      </div>

      <h4 class="block-title">Five-year cost — ${money(car.tco5)}</h4>
      <div class="cost-bars">
        ${car.costParts.map((p) => `
          <div class="cost-row">
            <span class="cost-label">${esc(p.label)}</span>
            <span class="cost-bar"><i style="width:${maxPart ? (p.value / maxPart * 100).toFixed(1) : 0}%"></i></span>
            <span class="cost-val">${money(p.value)}</span>
          </div>`).join('')}
      </div>
      <p class="muted small">
        Cash required: <b>${money(car.acquisition)}</b> — MSRP ${money(car.msrp)} + ${money(car.registration)} registration${car.discount ? `, less ${money(car.discount)} negotiated` : ''}.
        Modeled value after five years: ${money(car.residualValue)} (${Math.round(car.residual * 100)}% of list).
      </p>

      <div class="pros-cons">
        <div class="pros"><h4>Pros</h4><ul>${(car.pros || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
        <div class="cons"><h4>Cons</h4><ul>${(car.cons || []).map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>
      </div>

      ${car.notes ? `<p class="small note-block">${esc(car.notes)}</p>` : ''}

      <dl class="facts">
        ${car.trims ? `<dt>Trims</dt><dd>${esc(car.trims)}</dd>` : ''}
        ${car.consumptionBasis ? `<dt>Economy basis</dt><dd>${esc(car.consumptionBasis)}</dd>` : ''}
        ${car.safetyBasis ? `<dt>Safety basis</dt><dd>${esc(car.safetyBasis)}</dd>` : ''}
        ${car.cargoMax ? `<dt>Cargo, seats folded</dt><dd>${car.cargoMax.toLocaleString('en-US')} L</dd>` : ''}
        ${car.battery ? `<dt>Battery</dt><dd>${esc(car.battery)}</dd>` : ''}
        ${car.warranty ? `<dt>Warranty</dt><dd>${esc(car.warranty)}</dd>` : ''}
        ${car.discountTarget ? `<dt>Negotiation target</dt><dd>${money(car.discountTarget[0])}–${money(car.discountTarget[1])} combined across cash, accessories, trade-in uplift, service or subsidised finance</dd>` : ''}
      </dl>

      <h4 class="block-title">Against your priorities</h4>
      <p class="small muted">Strongest on ${strengths.slice(0, 3).map((p) => esc(p.label.toLowerCase())).join(', ') || 'nothing weighted'}${strengths.length ? `; weakest on ${esc(strengths[strengths.length - 1].label.toLowerCase())}` : ''}.</p>

      <h4 class="block-title">Where to see it — Haifa area</h4>
      ${dealerBlock(car, false)}

      <p class="small"><a href="${esc(car.link)}" target="_blank" rel="noopener">Official Israeli model page ↗</a></p>
      ${img ? `<p class="muted tiny">Photo: ${esc(img.credit)}, ${esc(img.license)} — <a href="${esc(img.source)}" target="_blank" rel="noopener">source</a>. Illustrative of the model generation, not the Israeli trim.</p>` : ''}`;

    $('#car-dialog').showModal();
  }

  function renderQuoteOnly() {
    $('#quote-only').innerHTML = state.quoteOnly.map((car) => `
      <div class="quote-card">
        <h4>${esc(car.make)} ${esc(car.model)} <span class="pill">${esc(car.powertrain)}</span></h4>
        <p class="small muted">${esc(car.reason)}</p>
        <p class="small">${esc(car.notes)}</p>
        <p class="small"><strong>Warranty:</strong> ${esc(car.warranty)}</p>
        ${dealerBlock(car, true)}
        <p class="small"><a href="${esc(car.link)}" target="_blank" rel="noopener">Official page ↗</a></p>
      </div>`).join('');
  }

  function renderStatic() {
    const m = state.meta;
    const v = m.verdict || {};
    document.title = m.title || document.title;
    $('#site-title').textContent = m.title || '';
    $('#site-subtitle').textContent = m.subtitle || '';
    $('#updated').textContent = m.updated || '';
    $('#verdict-headline').textContent = v.headline || '';
    $('#verdict-text').textContent = v.text || '';
    $('#verdict-hierarchy').innerHTML = (v.hierarchy || []).map((h) => `<li>${esc(h)}</li>`).join('');

    $('#dealer-note').textContent = state.dealerNote || '';
    $('#limitations').innerHTML = state.limitations.map((l) => `<li>${esc(l)}</li>`).join('');    $('#sources').innerHTML = state.sources
      .map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a></li>`).join('');
    $('#credits').innerHTML = Object.values(state.images)
      .map((i) => `<li>${esc(i.caption)} — ${esc(i.credit)}, <a href="${esc(i.source)}" target="_blank" rel="noopener">${esc(i.license)}</a></li>`).join('');

    $('#timeline').innerHTML = state.timeline.map((t) => `
      <div class="timeline-step">
        <div class="timeline-when">${esc(t.when)}</div>
        <h4>${esc(t.phase)}</h4>
        <ul>${t.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
      </div>`).join('');
  }

  /* ------------------------------------------------------------------
     Main render pass
     ------------------------------------------------------------------ */

  function render() {
    const derived = state.cars.map((car) => computeDerived(car, state.assumptions));
    const scored = scoreCars(applyFilters(derived));
    const excluded = excludedPowertrains();

    renderVerdict(scored);
    renderPicks(scored);
    renderTable(sortCars(scored));

    const profile = activeProfile();
    const bits = [];
    if (excluded.size) bits.push(`${[...excluded].join(', ').toLowerCase()} excluded`);
    if (profile && profile.minCargo != null) bits.push(`boot under ${profile.minCargo} L or unpublished excluded`);
    const suffix = bits.length ? ` · ${bits.join(' · ')} by this profile` : '';
    $('#result-count').textContent = `${scored.length} of ${state.cars.length} modeled cars shown${suffix}`;

    // The charging-share slider only means anything while a plug-in is in play.
    const phevRow = document.getElementById('a-phevEvShare');
    if (phevRow) phevRow.closest('.slider-row').classList.toggle('off', excluded.has('Plug-in hybrid'));
  }

  /* ------------------------------------------------------------------
     Setup
     ------------------------------------------------------------------ */

  const uniques = (key) => [...new Set(state.cars.map((c) => c[key]).filter(Boolean))].sort();

  function defaultWeights() {
    const w = {};
    state.criteria.forEach((c) => { w[c.key] = c.defaultWeight ?? 5; });
    return w;
  }
  const defaultAssumptions = () => Object.assign({}, state.meta.assumptions);

  function syncBudgetControl() {
    const prices = state.cars.map((c) => computeDerived(c, state.assumptions).acquisition);
    const lo = Math.floor(Math.min(...prices) / 5000) * 5000;
    const hi = Math.ceil(Math.max(...prices) / 5000) * 5000;
    const budget = $('#budget');
    budget.min = lo; budget.max = hi; budget.step = 1000; budget.value = hi;
    state.filters.budget = hi;
    $('#budget-value').textContent = money(hi);
  }

  function syncFuelControl() {
    const v = state.cars.map((c) => c.fuel && c.fuel.l100).filter((x) => typeof x === 'number');
    const lo = Math.floor(Math.min(...v) * 10) / 10;
    const hi = Math.ceil(Math.max(...v) * 10) / 10;
    const el = $('#max-l100');
    if (!el) return;
    el.min = lo; el.max = hi; el.step = 0.1; el.value = hi;
    state.filters.maxL100 = hi;
    $('#max-l100-value').textContent = `${hi.toFixed(1)} L/100km`;
  }

  function bindControls() {
    $('#search').addEventListener('input', (e) => { state.filters.search = e.target.value; render(); });

    syncBudgetControl();
    $('#budget').addEventListener('input', (e) => {
      state.filters.budget = Number(e.target.value);
      $('#budget-value').textContent = money(state.filters.budget);
      render();
    });

    syncFuelControl();
    const fuelEl = $('#max-l100');
    if (fuelEl) {
      fuelEl.addEventListener('input', (e) => {
        state.filters.maxL100 = Number(e.target.value);
        $('#max-l100-value').textContent = `${state.filters.maxL100.toFixed(1)} L/100km`;
        render();
      });
    }

    const refreshChips = () => {
      renderChips('#filter-body', uniques('body'), state.filters.body);
      renderChips('#filter-powertrain', uniques('powertrain'), state.filters.powertrain);
      renderChips('#filter-make', uniques('make'), state.filters.make);
    };
    refreshChips();

    $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });

    $('#apply-discount').checked = !!state.assumptions.applyDiscount;
    $('#apply-discount').addEventListener('change', (e) => {
      state.assumptions.applyDiscount = e.target.checked;
      saveAssumptions();
      render();
    });

    $('#reset-weights').addEventListener('click', () => {
      const p = activeProfile();
      if (p) { selectProfile(p.id); return; }
      state.weights = defaultWeights();
      saveWeights(); renderWeights(); render();
    });

    $('#reset-assumptions').addEventListener('click', () => {
      state.assumptions = defaultAssumptions();
      saveAssumptions();
      $('#apply-discount').checked = !!state.assumptions.applyDiscount;
      renderAssumptions(); render();
    });

    $('#reset-filters').addEventListener('click', () => {
      state.filters.search = '';
      $('#search').value = '';
      state.filters.body.clear();
      state.filters.powertrain.clear();
      state.filters.make.clear();
      syncBudgetControl();
      syncFuelControl();
      refreshChips();
      render();
    });
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(LS_THEME); } catch (_) {}
    const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = saved || (dark ? 'dark' : 'light');
    $('#theme-toggle').addEventListener('click', () => {
      const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem(LS_THEME, next); } catch (_) {}
    });
  }

  function restore(key, base) {
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null');
      if (saved) {
        Object.keys(base).forEach((k) => {
          if (saved[k] != null && typeof saved[k] === typeof base[k]) base[k] = saved[k];
        });
      }
    } catch (_) {}
    return base;
  }

  async function init() {
    initTheme();
    try {
      const res = await fetch(DATA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      Object.assign(state, {
        meta: data.meta || {},
        criteria: data.criteria || [],
        cars: data.cars || [],
        quoteOnly: data.quoteOnly || [],
        dealers: data.dealers || {},
        dealerNote: data.dealerNote || '',
        images: data.images || {},
        sources: data.sources || [],
        limitations: data.limitations || [],
        timeline: data.timeline || [],
        profiles: data.profiles || []
      });

      // Normalised across the whole fleet once, so the index is stable
      // regardless of which cars the current filters happen to show.
      state.comfort = computeComfort(state.cars);

      let savedProfile = null;
      try { savedProfile = localStorage.getItem(LS_PROFILE); } catch (_) {}
      const known = state.profiles.some((p) => p.id === savedProfile);
      state.profile = savedProfile === '' ? null : (known ? savedProfile : (state.meta.defaultProfile || null));

      const start = activeProfile();
      state.weights = restore(LS_WEIGHTS, start ? Object.assign({}, start.weights) : defaultWeights());
      state.assumptions = restore(LS_ASSUMPTIONS, defaultAssumptions());
      if (start) {
        state.weightsCustom = !Object.keys(start.weights)
          .every((k) => (state.weights[k] ?? 0) === start.weights[k]);
      }

      renderStatic();
      renderProfiles();
      renderWeights();
      renderAssumptions();
      renderTableHead();
      renderQuoteOnly();
      bindControls();
      render();
    } catch (err) {
      $('#cars-body').innerHTML =
        `<tr><td class="empty">Could not load <code>${DATA_URL}</code> (${esc(err.message)}).<br>
         Serve this folder over HTTP — opening index.html from disk blocks fetch().</td></tr>`;
    }
  }

  init();
})();

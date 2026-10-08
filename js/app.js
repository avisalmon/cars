(() => {
  'use strict';

  const LS_WEIGHTS = 'cars.weights';
  const LS_THEME = 'cars.theme';

  const state = {
    meta: {},
    criteria: [],
    cars: [],
    weights: {},
    filters: { search: '', budget: null, body: new Set(), fuel: new Set(), status: new Set() },
    sort: 'score'
  };

  const $ = (sel) => document.querySelector(sel);

  /* ---------- theme ---------- */

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(LS_THEME, theme); } catch (_) {}
  }

  function initTheme() {
    let saved = null;
    try { saved = localStorage.getItem(LS_THEME); } catch (_) {}
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(saved || (prefersDark ? 'dark' : 'light'));
    $('#theme-toggle').addEventListener('click', () => {
      applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
    });
  }

  /* ---------- formatting ---------- */

  function formatValue(value, criterion) {
    if (value == null || Number.isNaN(value)) return '—';
    const unit = criterion.unit || '';
    if (unit === '$' || unit === '$/yr') {
      const money = (state.meta.currency || '$') + Math.round(value).toLocaleString('en-US');
      return unit === '$/yr' ? money + '/yr' : money;
    }
    if (unit === '/10') return value.toFixed(1);
    const rounded = Number.isInteger(value) ? value : Math.round(value * 10) / 10;
    return rounded.toLocaleString('en-US') + (unit ? ' ' + unit : '');
  }

  function money(value) {
    return (state.meta.currency || '$') + Math.round(value).toLocaleString('en-US');
  }

  /* ---------- scoring ---------- */

  // Min-max normalise each criterion across the cars currently in view, flip
  // direction for "lower is better", then take the weighted mean.
  function scoreCars(cars) {
    const ranges = {};
    state.criteria.forEach((c) => {
      const values = cars.map((car) => car[c.key]).filter((v) => typeof v === 'number' && !Number.isNaN(v));
      ranges[c.key] = values.length ? { min: Math.min(...values), max: Math.max(...values) } : null;
    });

    return cars.map((car) => {
      const parts = [];
      let weighted = 0;
      let totalWeight = 0;

      state.criteria.forEach((c) => {
        const weight = state.weights[c.key] ?? 0;
        const range = ranges[c.key];
        const raw = car[c.key];
        if (range == null || typeof raw !== 'number' || Number.isNaN(raw)) return;

        const span = range.max - range.min;
        let norm = span === 0 ? 1 : (raw - range.min) / span;
        if (c.direction === 'lower') norm = 1 - norm;
        const points = norm * 100;

        parts.push({ key: c.key, label: c.label, points, weight });
        if (weight > 0) {
          weighted += points * weight;
          totalWeight += weight;
        }
      });

      const score = totalWeight > 0 ? weighted / totalWeight : 0;
      return Object.assign({}, car, { _score: score, _parts: parts });
    });
  }

  /* ---------- filtering ---------- */

  function applyFilters(cars) {
    const { search, budget, body, fuel, status } = state.filters;
    const needle = search.trim().toLowerCase();

    return cars.filter((car) => {
      if (budget != null && typeof car.price === 'number' && car.price > budget) return false;
      if (body.size && !body.has(car.body)) return false;
      if (fuel.size && !fuel.has(car.fuel)) return false;
      if (status.size && !status.has(car.status)) return false;
      if (needle) {
        const haystack = [car.make, car.model, car.body, car.fuel, car.notes]
          .filter(Boolean).join(' ').toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }

  function sortCars(cars) {
    const sorted = cars.slice();
    switch (state.sort) {
      case 'price': sorted.sort((a, b) => a.price - b.price); break;
      case 'running': sorted.sort((a, b) => a.running - b.running); break;
      case 'reliability': sorted.sort((a, b) => b.reliability - a.reliability); break;
      case 'name': sorted.sort((a, b) => (a.make + a.model).localeCompare(b.make + b.model)); break;
      default: sorted.sort((a, b) => b._score - a._score);
    }
    return sorted;
  }

  /* ---------- rendering ---------- */

  function renderWeights() {
    const host = $('#weights');
    host.innerHTML = '';
    state.criteria.forEach((c) => {
      const weight = state.weights[c.key] ?? 0;
      const row = document.createElement('div');
      row.className = 'weight-row' + (weight === 0 ? ' off' : '');
      row.innerHTML = `
        <div class="weight-head">
          <label for="w-${c.key}" title="${c.hint || ''}">${c.label}</label>
          <b>${weight}</b>
        </div>
        <input type="range" id="w-${c.key}" min="0" max="10" step="1" value="${weight}">`;
      row.querySelector('input').addEventListener('input', (e) => {
        state.weights[c.key] = Number(e.target.value);
        row.querySelector('b').textContent = e.target.value;
        row.classList.toggle('off', Number(e.target.value) === 0);
        saveWeights();
        render();
      });
      host.appendChild(row);
    });
  }

  function saveWeights() {
    try { localStorage.setItem(LS_WEIGHTS, JSON.stringify(state.weights)); } catch (_) {}
  }

  function renderChipGroup(hostSel, values, set) {
    const host = $(hostSel);
    host.innerHTML = '';
    values.forEach((value) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chip';
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

  function renderTableHead() {
    const cols = state.criteria.slice(0, 6);
    $('#cars-head').innerHTML = '<tr>' +
      '<th>Car</th><th>Score</th>' +
      cols.map((c) => `<th title="${c.hint || ''}">${c.label}</th>`).join('') +
      '<th>Status</th></tr>';
  }

  function renderTable(cars) {
    const cols = state.criteria.slice(0, 6);
    const body = $('#cars-body');
    body.innerHTML = '';

    if (!cars.length) {
      body.innerHTML = `<tr><td class="empty" colspan="${cols.length + 3}">No cars match these filters.</td></tr>`;
      return;
    }

    cars.forEach((car, index) => {
      const tr = document.createElement('tr');
      if (car.status === 'rejected') tr.classList.add('rejected');
      tr.tabIndex = 0;
      tr.innerHTML = `
        <td>
          <div class="car-cell">
            <span class="rank">${index + 1}</span>
            <span>
              <span class="car-name">${car.make} ${car.model}</span><br>
              <span class="car-sub">${car.year} · ${car.body} · ${car.fuel}</span>
            </span>
          </div>
        </td>
        <td>
          <div class="score-cell">
            <span class="score-num">${car._score.toFixed(0)}</span>
            <span class="bar"><i style="width:${Math.max(2, car._score).toFixed(1)}%"></i></span>
          </div>
        </td>
        ${cols.map((c) => `<td>${formatValue(car[c.key], c)}</td>`).join('')}
        <td><span class="tag ${car.status || ''}">${car.status || '—'}</span></td>`;

      const open = () => openDialog(car);
      tr.addEventListener('click', open);
      tr.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
      body.appendChild(tr);
    });
  }

  function renderVerdict(ranked) {
    const host = $('#verdict');
    if (!ranked.length) {
      host.innerHTML = '<p class="muted">Nothing passes the current filters — loosen them to get a recommendation.</p>';
      return;
    }
    const byScore = ranked.slice().sort((a, b) => b._score - a._score).slice(0, 3);
    host.innerHTML = byScore.map((car, i) => {
      const best = car._parts.filter((p) => p.weight > 0).sort((a, b) => b.points - a.points)[0];
      return `
        <div class="verdict-card ${i === 0 ? 'top' : ''}">
          <div class="verdict-rank">${i === 0 ? 'Best match' : 'Runner-up ' + i}</div>
          <div class="verdict-name">${car.make} ${car.model}</div>
          <div class="verdict-score">${car._score.toFixed(0)}<span class="muted" style="font-size:14px;font-weight:400">/100</span></div>
          <div class="verdict-meta">${money(car.price)} · strongest on ${best ? best.label.toLowerCase() : 'n/a'}</div>
        </div>`;
    }).join('');
  }

  function openDialog(car) {
    const dialog = $('#car-dialog');
    const contributions = car._parts
      .filter((p) => p.weight > 0)
      .sort((a, b) => (b.points * b.weight) - (a.points * a.weight));

    $('#car-dialog-content').innerHTML = `
      <h3>${car.make} ${car.model}</h3>
      <p class="muted small">${car.year} · ${car.body} · ${car.fuel} · ${car.drivetrain || ''} · ${car.seats || '?'} seats</p>
      <div class="dialog-grid">
        ${state.criteria.map((c) => `
          <div class="dialog-stat"><span>${c.label}</span><b>${formatValue(car[c.key], c)}</b></div>`).join('')}
      </div>
      <div class="pros-cons">
        <div class="pros"><h4>Pros</h4><ul>${(car.pros || []).map((p) => `<li>${p}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
        <div class="cons"><h4>Cons</h4><ul>${(car.cons || []).map((p) => `<li>${p}</li>`).join('') || '<li class="muted">—</li>'}</ul></div>
      </div>
      ${car.notes ? `<p class="small" style="margin-top:14px">${car.notes}</p>` : ''}
      <p class="muted small">Scores best on: ${contributions.slice(0, 3).map((p) => p.label.toLowerCase()).join(', ') || 'nothing weighted'}.
      ${car.link ? ` · <a href="${car.link}" target="_blank" rel="noopener">Official site</a>` : ''}</p>`;
    dialog.showModal();
  }

  function render() {
    const filtered = applyFilters(state.cars);
    const scored = scoreCars(filtered);
    const sorted = sortCars(scored);

    renderVerdict(scored);
    renderTable(sorted);
    $('#result-count').textContent =
      `${sorted.length} of ${state.cars.length} cars shown`;
  }

  /* ---------- setup ---------- */

  function uniqueValues(key) {
    return [...new Set(state.cars.map((c) => c[key]).filter(Boolean))].sort();
  }

  function defaultWeights() {
    const weights = {};
    state.criteria.forEach((c) => { weights[c.key] = c.defaultWeight ?? 5; });
    return weights;
  }

  function bindControls() {
    $('#search').addEventListener('input', (e) => {
      state.filters.search = e.target.value;
      render();
    });

    const prices = state.cars.map((c) => c.price).filter((p) => typeof p === 'number');
    const maxPrice = Math.ceil((Math.max(...prices) * 1.1) / 1000) * 1000;
    const budget = $('#budget');
    budget.min = Math.floor(Math.min(...prices) / 1000) * 1000;
    budget.max = maxPrice;
    budget.value = maxPrice;
    state.filters.budget = maxPrice;
    $('#budget-value').textContent = money(maxPrice);
    budget.addEventListener('input', (e) => {
      state.filters.budget = Number(e.target.value);
      $('#budget-value').textContent = money(state.filters.budget);
      render();
    });

    renderChipGroup('#filter-body', uniqueValues('body'), state.filters.body);
    renderChipGroup('#filter-fuel', uniqueValues('fuel'), state.filters.fuel);
    renderChipGroup('#filter-status', uniqueValues('status'), state.filters.status);

    $('#sort').addEventListener('change', (e) => {
      state.sort = e.target.value;
      render();
    });

    $('#reset-weights').addEventListener('click', () => {
      state.weights = defaultWeights();
      saveWeights();
      renderWeights();
      render();
    });

    $('#reset-filters').addEventListener('click', () => {
      state.filters.search = '';
      $('#search').value = '';
      state.filters.body.clear();
      state.filters.fuel.clear();
      state.filters.status.clear();
      budget.value = budget.max;
      state.filters.budget = Number(budget.max);
      $('#budget-value').textContent = money(state.filters.budget);
      renderChipGroup('#filter-body', uniqueValues('body'), state.filters.body);
      renderChipGroup('#filter-fuel', uniqueValues('fuel'), state.filters.fuel);
      renderChipGroup('#filter-status', uniqueValues('status'), state.filters.status);
      render();
    });
  }

  async function init() {
    initTheme();
    try {
      const res = await fetch('data/cars.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();

      state.meta = data.meta || {};
      state.criteria = data.criteria || [];
      state.cars = data.cars || [];

      document.title = state.meta.title || document.title;
      $('#site-title').textContent = state.meta.title || 'Car comparison';
      $('#site-subtitle').textContent = state.meta.subtitle || '';
      $('#updated').textContent = state.meta.updated || 'recently';

      state.weights = defaultWeights();
      try {
        const saved = JSON.parse(localStorage.getItem(LS_WEIGHTS) || 'null');
        if (saved) {
          Object.keys(state.weights).forEach((k) => {
            if (typeof saved[k] === 'number') state.weights[k] = saved[k];
          });
        }
      } catch (_) {}

      renderWeights();
      renderTableHead();
      bindControls();
      render();
    } catch (err) {
      $('#cars-body').innerHTML =
        `<tr><td class="empty">Could not load <code>data/cars.json</code> (${err.message}).<br>
         Serve this folder over HTTP — opening index.html directly from disk blocks fetch().</td></tr>`;
    }
  }

  init();
})();

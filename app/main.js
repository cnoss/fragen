import { decrypt } from './crypto.js';
import {
  people, person, addPerson, renamePerson, removePerson,
  inVorrat, askedOn, toggleVorrat, toggleAsked, vorratOf, askedOf,
  isDiscarded, discarded, setDiscarded, isFavorite, toggleFavorite,
  exportData, importData, getPref, setPref, today,
} from './store.js';

const NEW_DAYS = 30;        // questions with a date younger than this show up under "Neu"
const SWIPE_THRESHOLD = 70; // px
const DATA_URL = 'data/fragen.enc';

const main = document.getElementById('main');
const nav = document.getElementById('nav');
const tabbar = document.getElementById('tabbar');
const status = document.getElementById('status');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const isApp = document.documentElement.classList.contains('is-app');
const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const state = {
  db: null,       // { built, categories, questions }
  cats: new Map(), // id -> category
  filter: getPref('filter', { cat: 'alle', person: null, status: 'alle' }),
  list: [],       // questions matching the filter, fixed until the filter changes
  index: 0,
};

const STATUS_LABELS = { alle: 'Alle', vorrat: 'Vorrat', offen: 'Offen', gestellt: 'Gestellt' };

// ---------------------------------------------------------------------------
// Helpers

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

function setMain(...children) {
  main.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false && c !== ''));
}

function announce(message) {
  status.textContent = '';
  requestAnimationFrame(() => { status.textContent = message; });
}

function formatDate(iso, { year = false } = {}) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric', ...(year && { year: '2-digit' }) });
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function focusMain() {
  main.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

const isNew = (q) => !!q.added && (Date.now() - new Date(q.added)) / 86400000 < NEW_DAYS;

/** All questions except the sorted-out ones. */
const active = () => state.db.questions.filter((q) => !isDiscarded(q.id));

// ---------------------------------------------------------------------------
// Filter

function matchesStatus(q, filter) {
  if (!filter.person || filter.status === 'alle') return true;
  const asked = askedOn(filter.person, q.id);
  if (filter.status === 'gestellt') return !!asked;
  if (filter.status === 'offen') return !asked;
  return inVorrat(filter.person, q.id) && !asked; // vorrat
}

function matchesCat(q, cat) {
  if (cat === 'alle') return true;
  if (cat === 'neu') return isNew(q);
  if (cat === 'favoriten') return isFavorite(q.id);
  return q.cat === cat;
}

/** Rebuild the list for the current filter, staying on the current question if possible. */
function applyFilter(keepId = state.list[state.index]?.id || getPref('pos', null)) {
  const f = state.filter;
  if (f.person && !person(f.person)) Object.assign(f, { person: null, status: 'alle' });
  if (!['alle', 'neu', 'favoriten'].includes(f.cat) && !state.cats.has(f.cat)) f.cat = 'alle';
  setPref('filter', f);
  state.list = active().filter((q) => matchesCat(q, f.cat) && matchesStatus(q, f));
  const index = state.list.findIndex((q) => q.id === keepId);
  state.index = Math.max(0, index);
}

// ---------------------------------------------------------------------------
// Navigation

const NAV = [
  { href: '#/', label: 'Fragen', icon: 'cards', match: /^#?\/?$/ },
  { href: '#/personen', label: 'Personen', icon: 'people', match: /^#\/person/ },
  { href: '#/mehr', label: 'Mehr', icon: 'more', match: /^#\/mehr/ },
];

const ICONS = {
  cards: '<rect x="7" y="2.5" width="12" height="16" transform="rotate(10 13 10.5)"/><rect x="4" y="5.5" width="12" height="16"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-4 3-6.5 6.5-6.5s6.5 2.5 6.5 6.5"/><path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 13.8c2.2.8 3.5 2.9 3.5 6.2"/>',
  more: '<path d="M4 11h3v3H4zM10.5 11h3v3h-3zM17 11h3v3h-3z"/>',
};

function renderNav() {
  const current = (item) => (item.match.test(location.hash) ? 'page' : null);
  nav.replaceChildren(...NAV.map((item) => h('li', null, h('a', { href: item.href, 'aria-current': current(item) }, item.label))));
  tabbar.replaceChildren(...NAV.map((item) => {
    const icon = h('span', { class: 'tab-icon', 'aria-hidden': 'true' });
    icon.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2">${ICONS[item.icon]}</svg>`;
    return h('li', null, h('a', { href: item.href, 'aria-current': current(item) }, icon, h('span', null, item.label)));
  }));
}

function route() {
  if (!state.db) return;
  renderNav();
  const hash = location.hash;
  const personMatch = hash.match(/^#\/person\/(.+)$/);
  if (personMatch) return renderPerson(decodeURIComponent(personMatch[1]));
  if (hash === '#/personen') return renderPeople();
  if (hash === '#/mehr') return renderMore();
  renderCards();
}

/** Open the card view for one question, optionally filtered to a person. */
function openQuestion(questionId, filter) {
  state.filter = { cat: 'alle', person: null, status: 'alle', ...filter };
  setPref('pos', questionId);
  applyFilter(questionId);
  location.hash = '#/';
}

// ---------------------------------------------------------------------------
// Cards view

function renderCards() {
  applyFilter();
  setMain(
    installHint(),
    filterBar(),
    h('div', { id: 'stage' }),
    personFilter(),
  );
  scrollChipIntoView();
  renderStage();
  focusMain();
}

// Keep the active category chip in view.
function scrollChipIntoView() {
  const chip = main.querySelector('.chips [aria-pressed="true"]');
  if (chip) chip.parentElement.scrollLeft = chip.offsetLeft - chip.parentElement.offsetLeft - 16;
}

/** Update the counts on the chips without touching the rest of the page. */
function refreshChips() {
  main.querySelector('.filters')?.replaceWith(filterBar());
  scrollChipIntoView();
}

function filterBar() {
  const f = state.filter;
  const base = active().filter((q) => matchesStatus(q, f));
  const count = (cat) => base.filter((q) => matchesCat(q, cat)).length;
  const newCount = count('neu');
  const favCount = count('favoriten');

  const chip = (value, label) => h('button', {
    type: 'button', class: 'segment', 'aria-pressed': String(f.cat === value),
    onclick: () => { f.cat = value; renderCards(); },
  }, label, h('span', { class: 'segment-count' }, ` ${count(value)}`));

  return h('section', { class: 'filters', 'aria-label': 'Kategorie' },
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Kategorie' },
      chip('alle', 'Alle'),
      (favCount > 0 || f.cat === 'favoriten') && chip('favoriten', '♥ Favoriten'),
      (newCount > 0 || f.cat === 'neu') && chip('neu', 'Neu'),
      state.db.categories.map((c) => chip(c.id, c.titel)),
    ),
  );
}

/** "Fragen für …": below the card, so the top stays calm. */
function personFilter() {
  const f = state.filter;
  const persons = people();
  if (!persons.length) return null;
  const select = h('select', {
    id: 'person-filter',
    onchange: (e) => {
      f.person = e.target.value || null;
      const hasVorrat = f.person && Object.keys(vorratOf(f.person)).some((qid) => !askedOn(f.person, qid));
      f.status = !f.person ? 'alle' : hasVorrat ? 'vorrat' : 'offen';
      renderCards();
    },
  },
  h('option', { value: '' }, 'alle Personen'),
  persons.map((p) => h('option', { value: p.id, selected: p.id === f.person }, p.name)));

  return h('section', { class: 'person-filters', 'aria-labelledby': 'person-filter-title' },
    h('h2', { id: 'person-filter-title' }, 'Fragen für …'),
    h('div', { class: 'person-filter' },
      h('label', { for: 'person-filter', class: 'visually-hidden' }, 'Person'),
      select,
    ),
    f.person && h('div', { class: 'status-filter', role: 'group', 'aria-label': 'Status' },
      Object.entries(STATUS_LABELS).map(([value, label]) => h('button', {
        type: 'button', class: 'segment segment--small', 'aria-pressed': String(f.status === value),
        onclick: () => { f.status = value; renderCards(); },
      }, label)),
    ),
  );
}

function renderStage({ focus = false } = {}) {
  const stage = document.getElementById('stage');
  if (!stage) return;
  const q = state.list[state.index];
  if (!q) {
    stage.replaceChildren(h('p', { class: 'empty' }, emptyText()));
    return;
  }
  setPref('pos', q.id);
  const cat = state.cats.get(q.cat);
  const card = h('article', { class: 'qcard', id: 'card', 'aria-roledescription': 'Karte' },
    h('p', { class: 'qcard-meta' },
      h('span', { class: 'qcard-cat' }, cat?.titel || q.cat),
      isNew(q) && h('span', { class: 'badge badge--new' }, 'Neu'),
      favButton(q),
    ),
    h('h2', { class: 'question', id: 'question', tabindex: '-1' }, q.text),
    h('div', { class: 'qcard-foot' },
      h('button', { type: 'button', class: 'discard', onclick: () => discard(q) }, 'Aussortieren'),
      h('p', { class: 'qcard-count' }, filterHint(), `${state.index + 1} / ${state.list.length}`),
    ),
  );
  attachSwipe(card);

  const single = state.list.length < 2;
  stage.replaceChildren(
    h('div', { class: 'card-stage' }, card),
    h('div', { class: 'card-nav' },
      h('button', { type: 'button', class: 'button', disabled: single, onclick: () => go(-1) }, '← Zurück'),
      h('button', { type: 'button', class: 'button button--primary', disabled: single, onclick: () => go(1) }, 'Weiter →'),
    ),
    forWhom(q),
  );
  if (focus) document.getElementById('question').focus({ preventScroll: true });
}

function favButton(q) {
  const on = isFavorite(q.id);
  return h('button', {
    type: 'button', class: 'fav', 'aria-pressed': String(on), 'aria-label': 'Favorit',
    onclick: (e) => {
      const now = toggleFavorite(q.id);
      e.currentTarget.replaceWith(favButton(q));
      refreshChips();
      announce(now ? 'Als Favorit markiert.' : 'Kein Favorit mehr.');
    },
  }, on ? '♥' : '♡');
}

/** Small reminder on the card that a person filter is active (it lives at the bottom). */
function filterHint() {
  const f = state.filter;
  const name = f.person && person(f.person)?.name;
  if (!name) return null;
  return h('span', { class: 'filter-hint' }, `${STATUS_LABELS[f.status]} · ${name}`);
}

/** Sort a question out: gone from all lists right away, with undo. */
function discard(q) {
  setDiscarded(q.id, true);
  const at = state.index;
  state.list.splice(at, 1);
  if (state.index >= state.list.length) state.index = 0;
  renderStage();
  const stage = document.getElementById('stage');
  const toast = h('div', { class: 'toast', role: 'status' },
    h('span', null, 'Aussortiert.'),
    h('button', {
      type: 'button', class: 'button button--small',
      onclick: () => {
        setDiscarded(q.id, false);
        state.list.splice(at, 0, q);
        state.index = at;
        renderStage({ focus: true });
        refreshChips();
        announce('Wiederhergestellt.');
      },
    }, 'Rückgängig'));
  stage.prepend(toast);
  refreshChips();
  announce('Frage aussortiert. Rückgängig ist möglich.');
}

function emptyText() {
  const f = state.filter;
  const cat = state.cats.get(f.cat);
  return baseEmptyText() + (cat ? ` (Filter: ${cat.titel})` : '');
}

function baseEmptyText() {
  const f = state.filter;
  const name = f.person && person(f.person)?.name;
  if (name && f.status === 'vorrat') return `Noch nichts im Vorrat für ${name}. Tipp bei einer Frage auf „Vorrat“ neben dem Namen.`;
  if (name && f.status === 'gestellt') return `Du hast ${name} in dieser Auswahl noch keine Frage gestellt.`;
  if (f.cat === 'neu') return 'Gerade gibt es keine neuen Fragen.';
  if (f.cat === 'favoriten') return 'Noch keine Favoriten. Tipp auf das Herz bei Fragen, die richtig gut sind.';
  return 'Keine Fragen in dieser Auswahl.';
}

/** People rows below the card: note for later ("Vorrat") or mark as asked today. */
function forWhom(q) {
  const persons = people();
  if (!persons.length) {
    return h('section', { class: 'for-whom' },
      h('p', { class: 'muted small' }, 'Leg unter ', h('a', { href: '#/personen' }, 'Personen'), ' deine Leute an, dann kannst du Fragen für sie vormerken und abhaken.'));
  }
  const current = state.filter.person;
  const sorted = current ? [...persons].sort((a, b) => (b.id === current) - (a.id === current)) : persons;
  return h('section', { class: 'for-whom', 'aria-labelledby': 'for-whom-title' },
    h('h2', { id: 'for-whom-title' }, 'Für wen?'),
    h('ul', { class: 'people-rows' }, sorted.map((p) => personRow(p, q))),
  );
}

function personRow(p, q) {
  const asked = askedOn(p.id, q.id);
  const vorrat = inVorrat(p.id, q.id);
  return h('li', { class: `person-row${p.id === state.filter.person ? ' person-row--current' : ''}` },
    h('span', { class: 'person-name' }, p.name),
    h('button', {
      type: 'button', class: 'toggle toggle--vorrat', 'aria-pressed': String(vorrat),
      'aria-label': `${p.name}: Vorrat`,
      onclick: (e) => {
        const on = toggleVorrat(p.id, q.id);
        e.currentTarget.closest('li').replaceWith(personRow(p, q));
        announce(on ? `Für ${p.name} vorgemerkt.` : `Aus dem Vorrat für ${p.name} entfernt.`);
      },
    }, vorrat ? '★' : '☆', ' Vorrat'),
    h('button', {
      type: 'button', class: 'toggle toggle--asked', 'aria-pressed': String(!!asked),
      'aria-label': `${p.name}: gestellt`,
      onclick: (e) => {
        const on = toggleAsked(p.id, q.id);
        e.currentTarget.closest('li').replaceWith(personRow(p, q));
        announce(on ? `Bei ${p.name} als gestellt markiert.` : `Markierung bei ${p.name} entfernt.`);
      },
    }, asked ? `✓ ${formatDate(asked)}` : 'Gestellt'),
  );
}

function go(delta, { via = 'button' } = {}) {
  const n = state.list.length;
  if (n < 2) return;
  state.index = (state.index + delta + n) % n;
  const card = document.getElementById('card');
  if (!card || reducedMotion.matches) {
    renderStage({ focus: via !== 'swipe' });
    return;
  }
  // Slide out, swap, slide in from the other side.
  card.classList.add('is-leaving');
  card.style.setProperty('--dx', `${delta > 0 ? -110 : 110}%`);
  card.style.setProperty('--rot', `${delta > 0 ? -8 : 8}deg`);
  setTimeout(() => {
    renderStage({ focus: via !== 'swipe' });
    const next = document.getElementById('card');
    next.classList.add('is-dragging');
    next.style.setProperty('--dx', `${delta > 0 ? 40 : -40}px`);
    next.getBoundingClientRect(); // commit the start position
    next.classList.remove('is-dragging');
    next.style.removeProperty('--dx');
  }, 140);
}

function attachSwipe(card) {
  let start = null;
  let dragging = false;

  const reset = () => {
    start = null;
    dragging = false;
    card.classList.remove('is-dragging');
    card.style.removeProperty('--dx');
    card.style.removeProperty('--rot');
  };

  card.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.target.closest('a, button')) return;
    start = { x: e.clientX, y: e.clientY, id: e.pointerId };
  });

  card.addEventListener('pointermove', (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (!dragging) {
      if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) {
        dragging = true;
        card.setPointerCapture(e.pointerId);
        card.classList.add('is-dragging');
      } else if (Math.abs(dy) > 10) {
        start = null; // vertical scroll, not a swipe
        return;
      } else {
        return;
      }
    }
    card.style.setProperty('--dx', `${dx}px`);
    card.style.setProperty('--rot', `${(dx / 40).toFixed(1)}deg`);
  });

  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    const wasDragging = dragging;
    if (wasDragging && Math.abs(dx) >= SWIPE_THRESHOLD && state.list.length > 1) {
      start = null;
      dragging = false;
      card.classList.remove('is-dragging');
      go(dx < 0 ? 1 : -1, { via: 'swipe' });
      return;
    }
    reset();
  };
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', reset);
}

document.addEventListener('keydown', (e) => {
  if (!document.getElementById('card') || document.querySelector('dialog[open]')) return;
  if (e.altKey || e.ctrlKey || e.metaKey || e.target.closest('input, textarea, select')) return;
  if (e.key === 'ArrowRight') { e.preventDefault(); go(1, { via: 'keyboard' }); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1, { via: 'keyboard' }); }
});

function installHint() {
  if (!isIOS || isApp || getPref('installHintDismissed', false)) return null;
  const hint = h('section', { class: 'install-hint', 'aria-labelledby': 'install-title' },
    h('h2', { id: 'install-title' }, 'Mach eine App draus'),
    installSteps(),
    h('button', {
      type: 'button', class: 'button',
      onclick: () => { setPref('installHintDismissed', true); hint.remove(); announce('Tipp ausgeblendet. Du findest ihn unter Mehr.'); },
    }, 'Okay'),
  );
  return hint;
}

function installSteps() {
  return h('p', null, 'In Safari auf Teilen tippen (Quadrat mit Pfeil) und „Zum Home-Bildschirm“ wählen. Achtung: Die App hat ihren eigenen Speicher – Personen und Häkchen aus Safari sind dort nicht drin (über Export/Import mitnehmen).');
}

// ---------------------------------------------------------------------------
// People

function renderPeople() {
  const persons = people();
  const input = h('input', { type: 'text', id: 'new-person', autocomplete: 'off', autocapitalize: 'words', enterkeyhint: 'done', required: true });
  const form = h('form', {
    class: 'add-person',
    onsubmit: (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (!name) return;
      addPerson(name);
      renderPeople();
      announce(`${name} angelegt.`);
      document.getElementById('new-person').focus();
    },
  },
  h('label', { for: 'new-person' }, 'Neue Person'),
  h('div', { class: 'add-person__row' }, input, h('button', { type: 'submit', class: 'button button--primary' }, 'Anlegen')));

  setMain(
    h('h1', null, h('span', { class: 'mark' }, 'Personen')),
    h('p', { class: 'muted' }, 'Die Namen bleiben nur auf diesem Gerät.'),
    form,
    persons.length
      ? h('ul', { class: 'overview' }, persons.map((p) => {
        const vorrat = Object.keys(vorratOf(p.id)).filter((qid) => !askedOn(p.id, qid)).length;
        const asked = Object.keys(askedOf(p.id)).length;
        return h('li', { class: 'row' },
          h('a', { class: 'row-link', href: `#/person/${encodeURIComponent(p.id)}` },
            h('span', { class: 'row-main' },
              h('strong', null, p.name),
              h('span', { class: 'row-facts' }, `${vorrat} im Vorrat · ${asked} gestellt`))));
      }))
      : h('p', { class: 'empty' }, 'Noch niemand angelegt. Fang mit den Menschen an, mit denen du öfter sprichst.'),
  );
  focusMain();
}

function renderPerson(id) {
  const p = person(id);
  if (!p) {
    location.hash = '#/personen';
    return;
  }
  const byId = new Map(state.db.questions.map((q) => [q.id, q]));
  const vorrat = Object.entries(vorratOf(id)).filter(([qid]) => !askedOn(id, qid) && byId.has(qid) && !isDiscarded(qid))
    .sort((a, b) => state.db.questions.indexOf(byId.get(a[0])) - state.db.questions.indexOf(byId.get(b[0])));
  const asked = Object.entries(askedOf(id)).filter(([qid]) => byId.has(qid)).sort((a, b) => b[1].localeCompare(a[1]));

  const questionRow = (qid, extra, actions) => {
    const q = byId.get(qid);
    return h('li', { class: 'qrow' },
      h('button', { type: 'button', class: 'qrow-text', onclick: () => openQuestion(qid, { person: id }) },
        h('span', null, q.text),
        h('span', { class: 'row-facts' }, state.cats.get(q.cat)?.titel || q.cat, extra)),
      h('div', { class: 'qrow-actions' }, actions),
    );
  };

  setMain(
    h('p', { class: 'back' }, h('a', { href: '#/personen' }, '← Personen')),
    h('h1', null, h('span', { class: 'mark' }, p.name)),
    h('div', { class: 'form-actions' },
      h('button', { type: 'button', class: 'button button--primary', onclick: () => { state.filter = { cat: 'alle', person: id, status: 'offen' }; location.hash = '#/'; } }, 'Fragen durchgehen'),
    ),

    h('section', { class: 'person-section', 'aria-labelledby': 'vorrat-title' },
      h('h2', { id: 'vorrat-title' }, `Vorrat (${vorrat.length})`),
      vorrat.length
        ? h('ul', { class: 'qlist' }, vorrat.map(([qid]) => questionRow(qid, null, [
          h('button', { type: 'button', class: 'toggle', onclick: () => { toggleAsked(id, qid); renderPerson(id); announce('Als gestellt markiert.'); } }, 'Gestellt'),
          h('button', { type: 'button', class: 'button--quiet button button--tiny', 'aria-label': 'Aus dem Vorrat entfernen', onclick: () => { toggleVorrat(id, qid); renderPerson(id); announce('Aus dem Vorrat entfernt.'); } }, '✕'),
        ])))
        : h('p', { class: 'empty' }, `Noch keine Fragen für ${p.name} vorgemerkt. Bei jeder Frage kannst du unter „Für wen?“ auf „Vorrat“ tippen.`),
    ),

    h('section', { class: 'person-section', 'aria-labelledby': 'asked-title' },
      h('h2', { id: 'asked-title' }, `Gestellt (${asked.length})`),
      asked.length
        ? h('ul', { class: 'qlist' }, asked.map(([qid, date]) => questionRow(qid, ` · ${formatDate(date, { year: true })}`, [
          h('button', { type: 'button', class: 'toggle', 'aria-pressed': 'true', 'aria-label': 'Markierung „gestellt“ entfernen', onclick: () => { toggleAsked(id, qid); renderPerson(id); announce('Markierung entfernt.'); } }, '✓'),
        ])))
        : h('p', { class: 'empty' }, 'Noch keine Frage gestellt.'),
    ),

    editPerson(p),
  );
  focusMain();
}

function editPerson(p) {
  const input = h('input', { type: 'text', id: 'rename', value: p.name, autocomplete: 'off', required: true });
  const remove = h('button', {
    type: 'button', class: 'button button--quiet',
    onclick: (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.armed) {
        removePerson(p.id);
        announce(`${p.name} gelöscht.`);
        location.hash = '#/personen';
        return;
      }
      btn.dataset.armed = '1';
      btn.textContent = `Wirklich löschen? Vorrat und Häkchen gehen verloren.`;
    },
  }, 'Person löschen');
  return h('details', { class: 'more-section edit-person' },
    h('summary', null, 'Bearbeiten'),
    h('form', {
      class: 'add-person',
      onsubmit: (e) => { e.preventDefault(); if (input.value.trim()) { renamePerson(p.id, input.value); renderPerson(p.id); announce('Gespeichert.'); } },
    },
    h('label', { for: 'rename' }, 'Name'),
    h('div', { class: 'add-person__row' }, input, h('button', { type: 'submit', class: 'button' }, 'Speichern'))),
    h('div', { class: 'form-actions' }, remove),
  );
}

// ---------------------------------------------------------------------------
// More: export, import, update, lock

function renderMore() {
  const fileInput = h('input', {
    type: 'file', accept: 'application/json,.json', id: 'import-file', class: 'visually-hidden',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const result = importData(JSON.parse(await file.text()));
        setMoreStatus(`Importiert: ${plural(result.newPeople, 'neue Person', 'neue Personen')}, ${plural(result.entries, 'neuer Eintrag', 'neue Einträge')}.`);
      } catch (error) {
        setMoreStatus(error.message.startsWith('Das ist') ? error.message : 'Die Datei konnte nicht gelesen werden.');
      }
      e.target.value = '';
    },
  });
  const built = state.db.built ? new Date(state.db.built).toLocaleDateString('de-DE') : '?';
  const newCount = active().filter(isNew).length;

  setMain(
    h('h1', null, h('span', { class: 'mark' }, 'Mehr')),

    h('section', { class: 'more-section' },
      h('h2', null, 'Sichern & abgleichen'),
      h('p', null, 'Personen, Vorrat und Häkchen liegen nur auf diesem Gerät. Exportier sie ab und zu und schick sie dir per Mail – als Sicherung und zum Abgleichen.'),
      h('div', { class: 'form-actions' },
        h('button', { type: 'button', class: 'button button--primary', onclick: doExport }, 'Exportieren'),
        h('label', { for: 'import-file', class: 'button' }, 'Importieren'),
        fileInput,
      ),
      h('p', { class: 'small muted' }, 'Beim Import wird ergänzt, nichts überschrieben oder gelöscht.'),
      h('p', { id: 'more-status', class: 'export-status', role: 'status', 'aria-live': 'polite' }),
    ),

    h('section', { class: 'more-section' },
      h('h2', null, 'Fragen'),
      h('p', null, `${active().length} Fragen in ${state.db.categories.length} Kategorien, Stand ${built}.`
        + (newCount ? ` ${plural(newCount, 'Frage ist', 'Fragen sind')} neu.` : '')
        + ` „Neu“ zeigt Fragen der letzten ${NEW_DAYS} Tage.`),
      h('div', { class: 'form-actions' },
        h('button', { type: 'button', class: 'button', disabled: !navigator.onLine, onclick: () => location.reload() }, 'Jetzt aktualisieren')),
    ),

    discardedSection(),

    isIOS && !isApp && h('section', { class: 'more-section' },
      h('h2', null, 'Auf den Home-Bildschirm'),
      installSteps(),
    ),

    h('section', { class: 'more-section' },
      h('h2', null, 'Passwort'),
      h('p', null, 'Das Gerät merkt sich das Passwort. Hier kannst du es vergessen lassen, dann fragt die App beim nächsten Start neu.'),
      h('button', { type: 'button', class: 'button button--quiet', onclick: () => { setPref('passwort', undefined); location.reload(); } }, 'Passwort vergessen'),
    ),
  );
  focusMain();
}

function discardedSection() {
  const byId = new Map(state.db.questions.map((q) => [q.id, q]));
  const list = Object.entries(discarded()).filter(([qid]) => byId.has(qid)).sort((a, b) => b[1].localeCompare(a[1]));
  return h('section', { class: 'more-section', 'aria-labelledby': 'discarded-title' },
    h('h2', { id: 'discarded-title' }, `Aussortiert (${list.length})`),
    list.length
      ? [
        h('p', null, 'Diese Fragen tauchen nirgends mehr auf. Mit dem nächsten Export landen sie bei Claude und werden dann endgültig gelöscht.'),
        h('ul', { class: 'qlist' }, list.map(([qid, date]) => h('li', { class: 'qrow' },
          h('span', { class: 'qrow-text' },
            h('span', null, byId.get(qid).text),
            h('span', { class: 'row-facts' }, `${state.cats.get(byId.get(qid).cat)?.titel || ''} · ${formatDate(date, { year: true })}`)),
          h('div', { class: 'qrow-actions' },
            h('button', { type: 'button', class: 'toggle', onclick: () => { setDiscarded(qid, false); renderMore(); announce('Wiederhergestellt.'); } }, 'Zurückholen')),
        ))),
      ]
      : h('p', { class: 'muted' }, 'Nichts aussortiert. Auf jeder Karte kannst du Fragen, die nicht passen, mit „Aussortieren“ rauswerfen.'),
  );
}

function setMoreStatus(text) {
  const el = document.getElementById('more-status');
  if (el) el.textContent = text;
}

async function doExport() {
  const json = JSON.stringify(exportData(state.db.questions), null, 2);
  const name = `fragen-export-${today()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Fragen-Export' });
      setMoreStatus('Geteilt.');
      return;
    } catch (error) {
      if (error.name === 'AbortError') return;
    }
  }
  const link = h('a', { href: URL.createObjectURL(file), download: name });
  document.body.append(link);
  link.click();
  link.remove();
  setMoreStatus(`Gespeichert als ${name}.`);
}

// ---------------------------------------------------------------------------
// Unlock and start

function renderLock(payload, { wrong = false, changed = false } = {}) {
  const input = h('input', { type: 'password', id: 'pw', autocomplete: 'current-password', required: true, 'aria-describedby': wrong ? 'pw-error' : null, 'aria-invalid': wrong ? 'true' : null });
  const button = h('button', { type: 'submit', class: 'button button--primary' }, 'Entsperren');
  setMain(
    h('h1', null, h('span', { class: 'mark' }, 'Fragen')),
    h('p', { class: 'lead' }, 'Für bessere Gespräche mit deinen Leuten.'),
    h('form', {
      class: 'lock',
      onsubmit: async (e) => {
        e.preventDefault();
        button.disabled = true;
        button.textContent = 'Moment …';
        await unlock(payload, input.value);
      },
    },
    h('label', { for: 'pw' }, 'Passwort'),
    h('div', { class: 'add-person__row' }, input, button),
    wrong && h('p', { id: 'pw-error', class: 'error' }, changed ? 'Das Passwort hat sich geändert. Bitte neu eingeben.' : 'Das Passwort passt nicht.'),
    h('p', { class: 'small muted' }, 'Die Fragen liegen verschlüsselt im Netz. Das Passwort brauchst du nur einmal, danach merkt sich das Gerät es.'),
    ),
  );
  input.focus();
}

async function unlock(payload, password, { saved = false } = {}) {
  try {
    state.db = await decrypt(payload, password);
  } catch {
    renderLock(payload, { wrong: true, changed: saved });
    return;
  }
  setPref('passwort', password);
  state.cats = new Map(state.db.categories.map((c) => [c.id, c]));
  applyFilter();
  route();
}

async function init() {
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((error) => console.error(error));
  }
  if (isApp && navigator.storage?.persist) navigator.storage.persist().catch(() => {});
  const offline = document.getElementById('offline');
  const sync = () => { offline.hidden = navigator.onLine; };
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
  sync();

  let payload;
  try {
    payload = await (await fetch(DATA_URL, { cache: 'no-cache' })).json();
  } catch {
    setMain(h('p', { class: 'empty' }, 'Die Fragen konnten nicht geladen werden. Bist du offline? Beim ersten Start braucht die App einmal Internet.'));
    return;
  }
  window.addEventListener('hashchange', route);
  const saved = getPref('passwort', null);
  if (saved) await unlock(payload, saved, { saved: true });
  else renderLock(payload);
}

init();

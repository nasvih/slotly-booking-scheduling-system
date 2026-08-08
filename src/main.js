/* ============================================================
   slotly — boot: store, shell, nav, hash router, assistant.
   ============================================================ */

import { h, qs, icon, createStore, router, toast, modal, confirmDialog } from '../lib/ui.js';
import { STORE_KEY, seedState, todayKey, liveOn, OPEN_STATUSES } from './data.js';
import { buildAgent } from './agent.js';
import { openBooking } from './booking.js';

import renderToday from './views/today.js';
import renderCalendar from './views/calendar.js';
import renderBookings from './views/bookings.js';
import renderServices from './views/services.js';
import renderStaff from './views/staff.js';
import renderCustomers from './views/customers.js';
import renderSettings from './views/settings.js';

const store = createStore(STORE_KEY, seedState);

const VIEWS = [
  { id: 'today', label: 'Today', icon: 'clock', group: 'Desk', title: 'Today', sub: 'Live queue', render: renderToday },
  { id: 'calendar', label: 'Calendar', icon: 'calendar', group: 'Desk', title: 'Calendar', sub: 'Week grid', render: renderCalendar },
  { id: 'bookings', label: 'Bookings', icon: 'table', group: 'Desk', title: 'Bookings', sub: 'All records', render: renderBookings },
  { id: 'services', label: 'Services', icon: 'tag', group: 'Setup', title: 'Services', sub: 'Duration and price', render: renderServices },
  { id: 'staff', label: 'Staff', icon: 'users', group: 'Setup', title: 'Staff', sub: 'Working hours', render: renderStaff },
  { id: 'customers', label: 'Customers', icon: 'user', group: 'Setup', title: 'Customers', sub: 'History and no-shows', render: renderCustomers },
  { id: 'settings', label: 'Settings', icon: 'cog', group: 'Setup', title: 'Settings', sub: 'Desk configuration', render: renderSettings },
];

/* ---------- shell ---------- */
const app = qs('#app');

const sideEl = h('aside', { class: 'side', id: 'side' });
const navEl = h('nav', { class: 'side__nav', 'aria-label': 'Sections' });
const titleEl = h('div', { class: 'topbar__title' }, 'Today');
const subEl = h('div', { class: 'topbar__sub' }, 'Live queue');
const viewHost = h('main', { class: 'view view--pad', id: 'viewhost' });

const menuBtn = h('button', {
  class: 'btn btn--ghost btn--icon sidebtn', 'aria-label': 'Open navigation', 'aria-expanded': 'false',
  html: icon('menu'),
});
const setDrawer = (open) => {
  sideEl.classList.toggle('is-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
};
menuBtn.addEventListener('click', () => setDrawer(!sideEl.classList.contains('is-open')));
/* The open drawer covers the menu button, so it also has to close on an
   outside click and on Escape — otherwise the only way out is to navigate. */
document.addEventListener('click', (e) => {
  if (!sideEl.classList.contains('is-open')) return;
  if (sideEl.contains(e.target) || menuBtn.contains(e.target)) return;
  setDrawer(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sideEl.classList.contains('is-open')) setDrawer(false);
});

const newBtn = h('button', { class: 'btn btn--primary', html: `${icon('plus')}<span>New booking</span>` });
newBtn.addEventListener('click', () => openBooking(ctx, {}));

const ABOUT = [
  ['You can actually use it',
    'Every screen is live. Book a slot, move it, cancel it, call a token, edit a rota, change a service or rewrite a message template — nothing here is read-only and nothing is a mock-up.'],
  ['Your data stays on your machine',
    'Everything you enter is saved in this browser\'s local storage. There is no account, no server and no backend behind this build. Clear your browser data or use "Reset demo data" and it is all gone. It does not sync between browsers or devices.'],
  ['The assistant is simulated',
    'Slotly Desk answers by matching your question against this app\'s own demo data. It is a demonstration of the interaction, not a connected model, and no request leaves your browser.'],
];

function aboutModal() {
  modal({
    title: 'About this demo',
    width: '520px',
    body: h('div', { class: 'stack' }, ABOUT.map(([title, text]) => h('div', {},
      h('h4', { style: 'margin-bottom:4px' }, title),
      h('p', { class: 'small muted' }, text)))),
    actions: [{ label: 'Got it', class: 'btn--primary' }],
  });
}

const demoPill = h('button', {
  class: 'pill pill--amber',
  type: 'button',
  'aria-label': 'About this demo',
  title: 'Everything here is sample data held in this browser. Nothing is sent anywhere.',
}, 'Demo');
demoPill.addEventListener('click', aboutModal);

sideEl.appendChild(h('div', { class: 'side__brand' },
  h('span', { class: 'mark' }, 'SL'),
  h('div', {},
    h('div', { class: 'side__name' }, 'slotly'),
    h('div', { class: 'side__tag' }, 'Booking desk'))));
sideEl.appendChild(navEl);

const resetBtn = h('button', { class: 'navlink', title: 'Reset demo data', 'aria-label': 'Reset demo data', html: `${icon('refresh')}<span>Reset demo data</span>` });
resetBtn.addEventListener('click', async () => {
  const ok = await confirmDialog(
    'This puts every service, staff rota, customer and booking back to the sample set. Anything you changed in this browser is dropped.',
    { title: 'Reset demo data', danger: true, okLabel: 'Reset' });
  if (!ok) return;
  store.reset();
  toast('Demo data reset', 'ok');
});

const aboutBtn = h('button', { class: 'navlink', title: 'About this demo', 'aria-label': 'About this demo', html: `${icon('eye')}<span>About this demo</span>` });
aboutBtn.addEventListener('click', aboutModal);

/* ---------- sidebar preferences (own key, untouched by "Reset demo data") ---------- */
const UI_KEY = 'slotly.ui';
const ui = (() => {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (_) { return {}; }
})();
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (_) {} };

/* Rail mode is a desktop concern — under 900px the sidebar is already an
   off-canvas drawer, so the class is simply never applied there. */
const wide = window.matchMedia('(min-width:901px)');

const railBtn = h('button', {
  class: 'btn btn--sm',
  type: 'button',
  'data-act': 'rail',
  html: `${icon('arrowRight')}<span>Collapse</span>`,
});
const toneBtn = h('button', {
  class: 'btn btn--sm',
  type: 'button',
  'data-act': 'tone',
  html: `${icon('spark')}<span>Colour</span>`,
});

function applyChrome() {
  const rail = !!ui.rail && wide.matches;
  shellEl.classList.toggle('is-rail', rail);
  railBtn.setAttribute('aria-pressed', String(!!ui.rail));
  railBtn.setAttribute('aria-label', ui.rail ? 'Expand sidebar' : 'Collapse sidebar to icons');
  railBtn.title = ui.rail ? 'Expand sidebar' : 'Collapse sidebar to icons';
  railBtn.querySelector('svg').style.transform = ui.rail ? '' : 'rotate(180deg)';
  railBtn.querySelector('span').textContent = ui.rail ? 'Expand' : 'Collapse';

  if (ui.tone === 'amber') sideEl.setAttribute('data-tone', 'amber');
  else sideEl.removeAttribute('data-tone');
  toneBtn.setAttribute('aria-pressed', String(ui.tone === 'amber'));
  const toneLabel = ui.tone === 'amber' ? 'Use the white sidebar' : 'Use the brand yellow sidebar';
  toneBtn.setAttribute('aria-label', toneLabel);
  toneBtn.title = toneLabel;
}

railBtn.addEventListener('click', () => { ui.rail = !ui.rail; saveUI(); applyChrome(); });
toneBtn.addEventListener('click', () => { ui.tone = ui.tone === 'amber' ? null : 'amber'; saveUI(); applyChrome(); });
wide.addEventListener('change', applyChrome);

sideEl.appendChild(h('div', { class: 'side__foot' },
  aboutBtn,
  resetBtn,
  h('div', { class: 'side__toggles', style: 'margin-top:10px' }, railBtn, toneBtn),
  h('div', { class: 'side__sub small faint', style: 'padding:10px 10px 2px;line-height:1.5' },
    'Demo build by ',
    h('a', { class: 'linkish', href: 'https://www.nasvih.in', target: '_blank', rel: 'noopener' }, 'Muhammed Nasvih V'))));

const shellEl = h('div', { class: 'shell' },
  sideEl,
  h('div', { class: 'main' },
    h('header', { class: 'topbar' },
      menuBtn,
      h('div', { style: 'min-width:0' }, titleEl, subEl),
      h('div', { class: 'spacer' }),
      demoPill,
      newBtn),
    viewHost));
app.appendChild(shellEl);
applyChrome();

/* ---------- context handed to every view ---------- */
let current = 'today';
const ctx = {
  store,
  get state() { return store.state; },
  navigate: (p) => { location.hash = `#/${p}`; },
  refresh: () => draw(),
  params: [],
  query: new URLSearchParams(''),
};

/* ---------- nav ---------- */
function counts() {
  const s = store.state;
  const t = todayKey();
  return {
    today: liveOn(s, t).filter((b) => b.status !== 'done' && b.status !== 'no-show').length,
    bookings: s.bookings.filter((b) => OPEN_STATUSES.includes(b.status) && b.date >= t).length,
    services: s.services.filter((x) => x.active).length,
    staff: s.staff.filter((x) => x.active).length,
    customers: s.customers.length,
  };
}

function drawNav() {
  const c = counts();
  navEl.innerHTML = '';
  const groups = [...new Set(VIEWS.map((v) => v.group))];
  for (const g of groups) {
    const box = h('div', { class: 'navgroup' }, h('div', { class: 'navgroup__label' }, g));
    for (const v of VIEWS.filter((x) => x.group === g)) {
      const link = h('a', {
        class: `navlink${v.id === current ? ' is-active' : ''}`,
        href: `#/${v.id}`,
        title: `${v.label} — ${v.sub.toLowerCase()}`,
        'aria-label': v.label,
        'aria-current': v.id === current ? 'page' : null,
        html: `${icon(v.icon)}<span>${v.label}</span>`,
      });
      if (c[v.id] !== undefined) link.appendChild(h('span', { class: 'navlink__count mono' }, String(c[v.id])));
      link.addEventListener('click', () => setDrawer(false));
      box.appendChild(link);
    }
    navEl.appendChild(box);
  }
}

/* ---------- render ---------- */
function draw() {
  const v = VIEWS.find((x) => x.id === current) || VIEWS[0];
  titleEl.textContent = v.title;
  subEl.textContent = v.sub;
  document.title = `${v.title} · slotly`;
  const scroll = window.scrollY;
  viewHost.innerHTML = '';
  try {
    viewHost.appendChild(v.render(ctx));
  } catch (err) {
    viewHost.appendChild(h('div', { class: 'empty' },
      h('h3', {}, 'That screen could not be drawn'),
      h('p', { class: 'small muted' }, String(err && err.message ? err.message : err))));
  }
  drawNav();
  window.scrollTo(0, Math.min(scroll, document.body.scrollHeight));
}

const routes = Object.fromEntries(VIEWS.map((v) => [v.id, true]));
const nav = router(routes, (route, params, query) => {
  current = route;
  ctx.params = params;
  ctx.query = query;
  setDrawer(false);
  draw();
});
store.subscribe(() => draw());
nav.go();

/* ---------- assistant ---------- */
const bot = buildAgent(ctx);
bot.mount(document.body);

/* ---------- keyboard ---------- */
const SHORTCUTS = [
  ['1 … 7', 'Jump to a section in nav order'],
  ['N', 'New booking'],
  ['/', 'Focus the search box on this screen'],
  ['⌘K / Ctrl+K', 'Open the Slotly Desk assistant'],
  ['Esc', 'Close a dialog, drawer or the assistant'],
  ['?', 'Show this list'],
];

function shortcutsModal() {
  modal({
    title: 'Keyboard shortcuts',
    body: h('dl', { class: 'kv' }, SHORTCUTS.flatMap(([k, d]) => [
      h('dt', {}, k), h('dd', {}, d),
    ])),
    actions: [{ label: 'Close', class: 'btn--primary' }],
  });
}

document.addEventListener('keydown', (e) => {
  const t = e.target;
  const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key >= '1' && e.key <= '7') {
    const v = VIEWS[Number(e.key) - 1];
    if (v) ctx.navigate(v.id);
    return;
  }
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openBooking(ctx, {}); return; }
  if (e.key === '?') { e.preventDefault(); shortcutsModal(); return; }
  if (e.key === '/') {
    const box = qs('#viewhost .search .input');
    if (box) { e.preventDefault(); box.focus(); }
  }
});

window.slotly = { store, ctx };

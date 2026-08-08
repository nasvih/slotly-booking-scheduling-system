/* ============================================================
   slotly — boot: store, shell, nav, hash router, assistant.
   ============================================================ */

import { h, qs, icon, createStore, router, toast, modal, confirmDialog } from '../lib/ui.js';
import { initPWA } from '../lib/pwa.js';
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

const REPO_URL = 'https://github.com/nasvih/slotly-booking-scheduling-system';

/* Five blocks: what the product is, what it removes from a working day, what a
   real deployment would change, the demo disclaimer, and where to read the
   source. Each block is a paragraph, a short list or a link, so it stays
   scannable inside the modal at 390px. */
const ABOUT = [
  {
    title: 'What this is',
    text: 'Slotly runs a front desk. Booked appointments and walk-in tokens sit in the same queue on the same day, a week calendar shows every staff member side by side, and each service carries its own duration and buffer so the diary reflects how long the work actually takes. Every booking has a confirmation message written from a template.',
  },
  {
    title: 'Where it helps a business',
    list: [
      'The diary stops being a paper book that only one person can read.',
      'Double-booking becomes impossible — the slot is held the moment it is taken.',
      'Walk-ins get a token instead of a crowd at the counter.',
      'No-show patterns become visible per customer instead of being felt.',
      'Staff hours, breaks and days off are part of the booking rules, not something the receptionist has to remember.',
    ],
  },
  {
    title: 'How it would work for real',
    text: 'The same interface, with browser storage swapped for a real database, staff accounts behind a login, and confirmations actually sent by message or email. What you are looking at is the interface and the workflow, not the production system behind them.',
  },
  {
    title: 'How this demo works',
    list: [
      ['You can actually use it.', 'Every screen is live. Book a slot, move it, cancel it, call a token, edit a rota, change a service or rewrite a message template — nothing here is read-only and nothing is a mock-up.'],
      ['Your data stays on your machine.', 'Everything you enter is saved in this browser\'s local storage. There is no account, no server and no backend behind this build. Clear your browser data or use "Reset demo data" and it is all gone.'],
      ['The assistant is simulated.', 'Slotly Desk answers by matching your question against this app\'s own demo data. It is a demonstration of the interaction, not a connected model, and no request leaves your browser.'],
    ],
  },
  {
    title: 'Source',
    link: { href: REPO_URL, label: 'github.com/nasvih/slotly-booking-scheduling-system' },
    /* Must not read as more permissive than LICENSE: source-available, not
       open source, and anything past reading and running needs permission. */
    text: 'The source is published so it can be read, run and evaluated. It is not open source — copying, modifying, redistributing or using it in your own work needs the author\'s written permission.',
  },
];

function aboutModal() {
  modal({
    title: 'About this demo',
    width: '520px',
    body: h('div', { class: 'stack' }, ABOUT.map((block) => h('div', {},
      h('h4', { style: 'margin-bottom:4px' }, block.title),
      block.link ? h('p', { class: 'small', style: 'margin-bottom:4px' },
        h('a', {
          class: 'linkish mono aboutlink',
          href: block.link.href,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': `${block.link.label} — opens in a new tab`,
        }, block.link.label)) : null,
      block.text ? h('p', { class: 'small muted' }, block.text) : null,
      block.list ? h('ul', { class: 'aboutlist' }, block.list.map((line) => (
        Array.isArray(line)
          ? h('li', {}, h('b', {}, line[0]), ' ', line[1])
          : h('li', {}, line)
      ))) : null))),
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
  /* On a phone the sidebar is a fixed drawer at z-index 65 and the kit's scrim
     sits at 60, so a dialog opened from the footer would be covered by the very
     drawer it was opened from. The nav links already close it; so must these. */
  setDrawer(false);
  const ok = await confirmDialog(
    'This puts every service, staff rota, customer and booking back to the sample set. Anything you changed in this browser is dropped.',
    { title: 'Reset demo data', danger: true, okLabel: 'Reset' });
  if (!ok) return;
  store.reset();
  toast('Demo data reset', 'ok');
});

const aboutBtn = h('button', { class: 'navlink', title: 'About this demo', 'aria-label': 'About this demo', html: `${icon('eye')}<span>About this demo</span>` });
aboutBtn.addEventListener('click', () => { setDrawer(false); aboutModal(); });

/* The one dark element in the sidebar: it has to stand out against the yellow
   default without introducing a colour that is not already in the tokens. */
const EXTERNAL = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 11.5v4a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1h4"/><path d="M11.5 3.5h5v5"/><path d="M9 11l7.5-7.5"/></svg>';
const siteLink = h('a', {
  class: 'navlink sitelink',
  href: 'https://www.nasvih.in',
  target: '_blank',
  rel: 'noopener noreferrer',
  title: 'nasvih.in — opens in a new tab',
  'aria-label': 'nasvih.in — opens in a new tab',
  html: `${EXTERNAL}<span>nasvih.in</span>`,
});

/* Code brackets rather than the GitHub mark: the mark is a filled logo and
   every icon in this app is stroke SVG on currentColor. */
const CODE = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7 6.5L3.5 10 7 13.5"/><path d="M13 6.5L16.5 10 13 13.5"/><path d="M11.2 4.4L8.8 15.6"/></svg>';
const srcLink = h('a', {
  class: 'navlink srclink',
  href: REPO_URL,
  target: '_blank',
  rel: 'noopener noreferrer',
  title: 'Source on GitHub — opens in a new tab',
  'aria-label': 'Source on GitHub — opens in a new tab',
  html: `${CODE}<span>Source on GitHub</span>`,
});

/* ---------- sidebar preferences (own key, untouched by "Reset demo data") ---------- */
const UI_KEY = 'slotly.ui';
const ui = (() => {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (_) { return {}; }
})();
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (_) {} };

/* The brand yellow sidebar is the default. Only an explicit choice stored under
   this key can turn it off, so a fresh browser always opens yellow. Nothing is
   written back here — "no stored preference" stays literally true until the
   owner presses the control. */
if (!('tone' in ui)) ui.tone = 'amber';
else if (ui.tone !== 'amber') ui.tone = 'plain';

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

  const amber = ui.tone === 'amber';
  if (amber) sideEl.setAttribute('data-tone', 'amber');
  else sideEl.removeAttribute('data-tone');
  toneBtn.setAttribute('aria-pressed', String(amber));
  const toneLabel = amber ? 'Use the white sidebar' : 'Use the brand yellow sidebar';
  toneBtn.setAttribute('aria-label', toneLabel);
  toneBtn.title = toneLabel;
  /* the button names the move, not the state — same as Collapse/Expand, and it
     keeps the toggle readable without relying on the colour alone */
  toneBtn.querySelector('span').textContent = amber ? 'White' : 'Yellow';
}

railBtn.addEventListener('click', () => { ui.rail = !ui.rail; saveUI(); applyChrome(); });
toneBtn.addEventListener('click', () => { ui.tone = ui.tone === 'amber' ? 'plain' : 'amber'; saveUI(); applyChrome(); });
wide.addEventListener('change', applyChrome);

const installHost = h('div', { class: 'side__install' });

sideEl.appendChild(h('div', { class: 'side__foot' },
  resetBtn,
  aboutBtn,
  siteLink,
  srcLink,
  h('div', { class: 'side__toggles', style: 'margin-top:10px' }, railBtn, toneBtn),
  installHost,
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

/* ---------- installable ---------- */
/* Registers the service worker and adds an "Install app" control to the sidebar
   footer, but only when the browser says installing is actually possible. */
initPWA({
  mount: installHost,
  appName: 'Slotly',
  onNote: (msg) => toast(msg),
});

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

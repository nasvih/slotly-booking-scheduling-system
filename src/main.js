/* ============================================================
   slotly — boot: store, shell, nav, hash router, assistant.
   ============================================================ */

import { h, qs, icon, createStore, router, toast, modal, confirmDialog } from '../lib/ui.js';
import { initPWA } from '../lib/pwa.js';
import { STORE_KEY, seedState, ensureShape, todayKey, liveOn, OPEN_STATUSES } from './data.js';
import { buildAgent } from './agent.js';
import { openBooking } from './booking.js';
import { ACTION_EXAMPLES } from './actions.js';
import { mountBell } from './notify.js';
import { themeToggle, deviceControls, applyTheme, readTheme, IS_FRAMED } from './chrome.js';

import renderBook, { resetBookingPage } from './views/book.js';
import renderToday from './views/today.js';
import renderCalendar from './views/calendar.js';
import renderBookings from './views/bookings.js';
import renderServices from './views/services.js';
import renderStaff from './views/staff.js';
import renderCustomers from './views/customers.js';
import renderSettings from './views/settings.js';

/* The theme is read before anything is drawn — index.html sets it inline so
   there is no white flash, and this keeps the two in step. */
applyTheme(readTheme());

const store = createStore(STORE_KEY, seedState);
/* A state saved by an earlier build has no staff time-off list. */
ensureShape(store.state);
store.subscribe((s) => ensureShape(s));

/* The customer's page is the front door, so it is the first route and the one
   an empty hash lands on. It is deliberately not a member of VIEWS: it has no
   sidebar row, no section title and no desk chrome — it is the other side of
   the same product. Every existing #/… link still resolves to its desk view. */
const PUBLIC = 'book';

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

/* Its label is hidden at phone width, so the accessible name is carried on the
   button itself rather than by the span the stylesheet takes away. */
const newBtn = h('button', {
  class: 'btn btn--primary',
  'aria-label': 'New booking',
  title: 'New booking',
  html: `${icon('plus')}<span>New booking</span>`,
});
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
    title: 'What the assistant can change',
    text: 'Slotly Desk answers questions, and it also does the work. Type the request in plain words: it shows you exactly which record it read, and writes nothing until you press the button on its reply.',
    examples: ACTION_EXAMPLES,
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
      ))) : null,
      /* input on one line, what comes back under it — the same pairs the
         assistant prints for "What can you do?" */
      block.examples ? h('div', { class: 'exlist' }, block.examples.map((e) => h('div', { class: 'exrow' },
        h('div', { class: 'exrow__t' }, e.title),
        h('code', { class: 'exrow__in' }, e.input),
        h('p', { class: 'exrow__out small muted' }, e.output)))) : null))),
    actions: [{ label: 'Got it', class: 'btn--primary' }],
  });
}

/* The topbar's demo marker is the way into the modal, so it says what it does
   rather than just flagging the build. */
const demoPill = h('button', {
  class: 'pill pill--amber aboutpill',
  type: 'button',
  'aria-label': 'About this demo',
  title: 'Everything here is sample data held in this browser. Nothing is sent anywhere.',
}, 'About this demo');
demoPill.addEventListener('click', aboutModal);

const brandEl = h('div', { class: 'side__brand' },
  h('span', { class: 'mark' }, 'SL'),
  h('div', { style: 'min-width:0' },
    h('div', { class: 'side__name' }, 'slotly'),
    h('div', { class: 'side__tag' }, 'Booking desk')));
sideEl.appendChild(brandEl);
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

/* The one dark element in the sidebar: it has to stand out against the teal
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
  title: 'GitHub — opens in a new tab',
  'aria-label': 'GitHub — opens in a new tab',
  html: `${CODE}<span>GitHub</span>`,
});

/* ---------- sidebar preferences (own key, untouched by "Reset demo data") ---------- */
const UI_KEY = 'slotly.ui';
const ui = (() => {
  try { return JSON.parse(localStorage.getItem(UI_KEY)) || {}; } catch (_) { return {}; }
})();
const saveUI = () => { try { localStorage.setItem(UI_KEY, JSON.stringify(ui)); } catch (_) {} };

/* The brand teal sidebar is the default. Only an explicit choice stored under
   this key can turn it off, so a fresh browser always opens teal. Nothing is
   written back here — "no stored preference" stays literally true until the
   owner presses the control. */
if (!('tone' in ui)) ui.tone = 'amber';
else if (ui.tone !== 'amber') ui.tone = 'plain';

/* Rail mode is a desktop concern — under 900px the sidebar is already an
   off-canvas drawer, so the class is simply never applied there. */
const wide = window.matchMedia('(min-width:901px)');

/* Both controls sit on the brand row, right of the name, and show a glyph and
   nothing else — the kit clips their span. So the glyphs have to carry the
   meaning: a panel with a chevron pointing at the edge the sidebar is about to
   move to, and a circle half filled for the colour. Stroke SVG on
   currentColor, like every other icon in the app. */
const RAIL_GLYPH = {
  collapse: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2"/><path d="M8 3.75v12.5"/><path d="M13.6 7.9L11.5 10l2.1 2.1"/></svg>',
  expand: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2"/><path d="M8 3.75v12.5"/><path d="M11.5 7.9L13.6 10l-2.1 2.1"/></svg>',
};
const TONE_GLYPH = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="6.6"/><path d="M10 3.4a6.6 6.6 0 0 1 0 13.2z" fill="currentColor" stroke="none"/></svg>';
/* the colour control names no colour at all: the glyph carries it and
   aria-pressed reports whether the teal tone is on */
const TONE_LABEL = 'Sidebar colour';

const railBtn = h('button', {
  class: 'btn btn--sm',
  type: 'button',
  'data-act': 'rail',
  html: `${RAIL_GLYPH.collapse}<span>Collapse sidebar</span>`,
});
const toneBtn = h('button', {
  class: 'btn btn--sm',
  type: 'button',
  'data-act': 'tone',
  title: TONE_LABEL,
  'aria-label': TONE_LABEL,
  html: `${TONE_GLYPH}<span>${TONE_LABEL}</span>`,
});
brandEl.appendChild(h('div', { class: 'side__brandbtns' }, railBtn, toneBtn));

function applyChrome() {
  const rail = !!ui.rail && wide.matches;
  shellEl.classList.toggle('is-rail', rail);
  const railLabel = ui.rail ? 'Expand sidebar' : 'Collapse sidebar';
  railBtn.setAttribute('aria-pressed', String(!!ui.rail));
  railBtn.setAttribute('aria-label', railLabel);
  railBtn.title = railLabel;
  railBtn.innerHTML = `${ui.rail ? RAIL_GLYPH.expand : RAIL_GLYPH.collapse}<span>${railLabel}</span>`;

  const amber = ui.tone === 'amber';
  if (amber) sideEl.setAttribute('data-tone', 'amber');
  else sideEl.removeAttribute('data-tone');
  toneBtn.setAttribute('aria-pressed', String(amber));
}

railBtn.addEventListener('click', () => { ui.rail = !ui.rail; saveUI(); applyChrome(); });
toneBtn.addEventListener('click', () => { ui.tone = ui.tone === 'amber' ? 'plain' : 'amber'; saveUI(); applyChrome(); });
wide.addEventListener('change', applyChrome);

/* The way back out to the customer's page, in the topbar — the mirror of the
   "Staff desk" control that brought you in. A door you walked through in the
   header should be a door you can walk back through in the header. It drops
   to its glyph under 640px, the same move "New booking" and the staff control
   already make, so the sixth control still fits at 320. */
const publicBtn = h('a', {
  class: 'btn btn--sm topbar__public',
  href: `#/${PUBLIC}`,
  title: 'Booking page — the page customers see',
  'aria-label': 'Booking page — the page customers see',
  html: `${icon('eye')}<span>Booking page</span>`,
});

/* Footer: the way out, the two links, then install and reset. About moved to
   the topbar, where it sits next to the demo marker it explains.
   The paired rows share their width and truncate rather than overflow; the kit
   stacks them back into a single column in the rail. */
const installRow = h('div', { class: 'side__pair' }, resetBtn);

sideEl.appendChild(h('div', { class: 'side__foot' },
  h('div', { class: 'side__pair' }, siteLink, srcLink),
  installRow,
  h('div', { class: 'side__sub small faint', style: 'padding:10px 10px 2px;line-height:1.5' },
    'Demo build by ',
    h('a', { class: 'linkish', href: 'https://www.nasvih.in', target: '_blank', rel: 'noopener' }, 'Muhammed Nasvih V'))));

/* The three chrome controls are icon-only and sit together, so they read as one
   group of browser-level switches rather than as desk actions. They are filled
   in after the view context exists. */
const toolsEl = h('div', { class: 'topbar__tools' });

const shellEl = h('div', { class: 'shell' },
  sideEl,
  h('div', { class: 'main' },
    h('header', { class: 'topbar' },
      menuBtn,
      h('div', { class: 'topbar__id' }, titleEl, subEl),
      h('div', { class: 'spacer' }),
      publicBtn,
      demoPill,
      toolsEl,
      newBtn),
    viewHost));
app.appendChild(shellEl);
applyChrome();

/* ---------- the customer's shell ---------- */
/* No sidebar, no counts, no section title: one bar, one column, one footer.
   It is the same design system seen from the other side, so it uses the kit's
   type scale, radii, hairlines and the same accent — and none of the desk's
   words. The bar carries the desk's own name rather than the product's,
   because that is whose door this is. */
const pubName = h('div', { class: 'pubbar__name' });
const pubTag = h('div', { class: 'pubbar__tag' });
const pubStaffBtn = h('a', {
  class: 'btn btn--sm pubbar__staff',
  href: '#/today',
  title: 'Open the staff desk',
  'aria-label': 'Open the staff desk',
  html: `${icon('grid')}<span>Staff desk</span>`,
});
const pubHost = h('main', { class: 'pubmain', id: 'pubhost' });
/* The one node on this page that outlives every redraw. src/views/book.js
   writes each refusal and the confirmation into it, because a live region that
   is itself replaced by the update it is meant to announce announces nothing. */
const pubLive = h('p', { class: 'pub__sr', id: 'pub-live', role: 'status', 'aria-live': 'polite' });

/* Both footer controls are real buttons rather than links inside a sentence:
   this page is thumbed, and a 16px word in a paragraph is not a tap target. */
const pubAboutBtn = h('button', { class: 'btn btn--sm', type: 'button' }, 'About this demo');
pubAboutBtn.addEventListener('click', () => aboutModal());

const pubShell = h('div', { class: 'pubshell' },
  h('header', { class: 'pubbar' },
    /* Not a link: it would point at the page it is already on. */
    h('div', { class: 'pubbar__brand' },
      h('span', { class: 'mark' }, 'SL'),
      h('span', { class: 'pubbar__id' }, pubName, pubTag)),
    h('div', { class: 'spacer' }),
    themeToggle(),
    pubStaffBtn),
  pubLive,
  pubHost,
  h('footer', { class: 'pubfoot' },
    h('p', { class: 'small muted' },
      'A demo booking page. Everything on it is sample data kept in this browser — nothing is sent anywhere and no appointment is real.'),
    h('div', { class: 'pubfoot__acts' },
      pubAboutBtn,
      h('a', {
        class: 'btn btn--sm',
        href: 'https://www.nasvih.in',
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': 'nasvih.in — opens in a new tab',
      }, 'Built by nasvih.in'))));
app.appendChild(pubShell);

/* ---------- installable ---------- */
/* Registers the service worker and adds an "Install app" control to the sidebar
   footer, but only when the browser says installing is actually possible. */
/* initPWA appends, so its control is moved to the head of the row it shares
   with Reset. Hidden it is display:none, so the row never leaves a gap. */
const installBtn = initPWA({
  mount: installRow,
  appName: 'Slotly',
  onNote: (msg) => toast(msg),
});
if (installBtn) installRow.insertBefore(installBtn, installRow.firstChild);

/* ---------- context handed to every view ---------- */
let current = PUBLIC;
const ctx = {
  store,
  get state() { return store.state; },
  navigate: (p) => { location.hash = `#/${p}`; },
  refresh: () => draw(),
  params: [],
  query: new URLSearchParams(''),
};

/* ---------- topbar controls ---------- */
/* Notifications first, then the device preview, then light/dark — read order
   goes from "what needs me" to "how am I looking at it". Inside the phone
   frame the preview control is left out: previewing a preview is nonsense. */
toolsEl.appendChild(mountBell(ctx));
if (!IS_FRAMED) toolsEl.appendChild(deviceControls({ appName: 'slotly' }));
toolsEl.appendChild(themeToggle());

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
  const isPublic = current === PUBLIC;
  /* One of the two shells is in the document at a time. [hidden] is
     display:none!important in the kit, so the hidden one is out of the layout
     entirely rather than merely invisible. */
  shellEl.hidden = isPublic;
  pubShell.hidden = !isPublic;
  /* The desk assistant belongs to the desk. */
  document.body.classList.toggle('is-public', isPublic);

  const host = isPublic ? pubHost : viewHost;
  const v = isPublic ? null : (VIEWS.find((x) => x.id === current) || VIEWS[0]);
  if (isPublic) {
    pubName.textContent = store.state.settings.deskName;
    pubTag.textContent = store.state.settings.branch;
    document.title = 'Book an appointment · slotly';
  } else {
    titleEl.textContent = v.title;
    subEl.textContent = v.sub;
    document.title = `${v.title} · slotly`;
  }

  const scroll = window.scrollY;
  host.innerHTML = '';
  try {
    host.appendChild(isPublic ? renderBook(ctx) : v.render(ctx));
  } catch (err) {
    host.appendChild(h('div', { class: 'empty' },
      h('h3', {}, 'That screen could not be drawn'),
      h('p', { class: 'small muted' }, String(err && err.message ? err.message : err))));
  }
  if (!isPublic) drawNav();
  window.scrollTo(0, Math.min(scroll, document.body.scrollHeight));
}

/* PUBLIC is declared first, so an empty hash — the bare URL — resolves to it,
   and so does anything unrecognised. Every existing #/today, #/calendar … link
   still names its own view. */
const routes = Object.fromEntries([[PUBLIC, true], ...VIEWS.map((v) => [v.id, true])]);
const nav = router(routes, (route, params, query) => {
  /* Leaving the booking page throws its half-filled form and its confirmation
     away: the next visitor to that screen is a different person. */
  if (current === PUBLIC && route !== PUBLIC) resetBookingPage();
  current = route;
  ctx.params = params;
  ctx.query = query;
  setDrawer(false);
  if (bot && route === PUBLIC) bot.toggle(false);
  draw();
});
/* ---------- assistant ---------- */
/* Mounted before the first route runs: the router closes it when it lands on
   the customer's page, so it has to exist by then. */
const bot = buildAgent(ctx);
bot.mount(document.body);

store.subscribe(() => draw());
nav.go();

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

/* ⌘K opens the desk assistant, and lib/assistant.js listens for it on the
   document. The customer's page has no assistant, so it stops the key in the
   capture phase — before the document's own bubble listener ever sees it —
   rather than letting a panel open behind a stylesheet that hides it. */
document.addEventListener('keydown', (e) => {
  if (current !== PUBLIC) return;
  if ((e.metaKey || e.ctrlKey) && e.key && e.key.toLowerCase() === 'k') e.stopPropagation();
}, true);

document.addEventListener('keydown', (e) => {
  /* Every shortcut below is a desk shortcut — a number that jumps to a section,
     a key that opens the booking dialog. None of them mean anything on the
     customer's page, where the whole screen is the one thing to do. */
  if (current === PUBLIC) return;
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

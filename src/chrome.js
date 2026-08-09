/* ============================================================
   slotly — topbar chrome that is not about bookings:
   the light/dark switch and the device preview.
   Both are browser preferences rather than desk data, so they live
   under their own storage keys and survive "Reset demo data".
   ============================================================ */

import { h } from '../lib/ui.js';

export const THEME_KEY = 'slotly.theme';
export const IS_FRAMED = new URLSearchParams(location.search).has('frame');

/* ---------- dark mode ---------- */
const SUN = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="3.6"/><path d="M10 1.8v2.2M10 16v2.2M18.2 10H16M4 10H1.8M15.8 4.2l-1.6 1.6M5.8 14.2l-1.6 1.6M15.8 15.8l-1.6-1.6M5.8 5.8L4.2 4.2"/></svg>';
const MOON = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M16.2 12.4A6.8 6.8 0 0 1 7.6 3.8a6.9 6.9 0 1 0 8.6 8.6z"/></svg>';

export function readTheme() {
  let stored = null;
  try { stored = localStorage.getItem(THEME_KEY); } catch (_) { stored = null; }
  if (stored === 'dark' || stored === 'light') return stored;
  return 'light';
}

export function applyTheme(mode) {
  const dark = mode === 'dark';
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#141517' : '#B82D6E');
}

/**
 * The switch itself. It only writes to storage when pressed — until then the
 * app follows the operating system, which is what a first visit should do.
 */
export function themeToggle() {
  let mode = readTheme();
  const btn = h('button', { class: 'btn btn--ghost btn--icon', type: 'button' });
  const paint = () => {
    applyTheme(mode);
    const label = mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
    btn.innerHTML = mode === 'dark' ? SUN : MOON;
    btn.setAttribute('aria-label', label);
    btn.setAttribute('aria-pressed', String(mode === 'dark'));
    btn.title = label;
  };
  btn.addEventListener('click', () => {
    mode = mode === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, mode); } catch (_) { /* preference is lost, the app is not */ }
    paint();
  });
  /* Follow the system until somebody has actually chosen. */
  if (window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onSystem = () => {
      let stored = null;
      try { stored = localStorage.getItem(THEME_KEY); } catch (_) { stored = null; }
      if (stored === 'dark' || stored === 'light') return;
      mode = 'light';
      paint();
    };
    if (mq.addEventListener) mq.addEventListener('change', onSystem);
  }
  paint();
  return btn;
}

/* ---------- device preview ---------- */
const PHONE = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="5.5" y="2.2" width="9" height="15.6" rx="2.2"/><path d="M8.6 15.4h2.8"/></svg>';
const DESKTOP = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2.4" y="3.6" width="15.2" height="10" rx="1.8"/><path d="M7 17h6M10 13.6V17"/></svg>';

const FRAME_W = 390;
const FRAME_H = 844;

/**
 * Phone mode puts the whole application inside a real 390×844 iframe, so the
 * breakpoints that matter fire for the same reason they fire on a phone —
 * the viewport genuinely is that wide. The framed copy carries ?frame=1 and
 * hides this control, so there is no preview inside the preview.
 */
export function deviceControls({ appName = 'slotly' } = {}) {
  const phoneBtn = h('button', {
    class: 'btn btn--ghost btn--icon', type: 'button',
    'aria-label': 'Preview at phone size', title: 'Preview at phone size',
    'aria-pressed': 'false', html: PHONE,
  });
  const deskBtn = h('button', {
    class: 'btn btn--ghost btn--icon is-on', type: 'button',
    'aria-label': 'Back to desktop size', title: 'Back to desktop size',
    'aria-pressed': 'true', html: DESKTOP,
  });
  const group = h('div', { class: 'devseg', role: 'group', 'aria-label': 'Device preview' }, deskBtn, phoneBtn);

  let stage = null;

  const setPressed = (phone) => {
    phoneBtn.setAttribute('aria-pressed', String(phone));
    deskBtn.setAttribute('aria-pressed', String(!phone));
    phoneBtn.classList.toggle('is-on', phone);
    deskBtn.classList.toggle('is-on', !phone);
  };

  function close() {
    if (!stage) return;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', fit);
    stage.remove();
    stage = null;
    document.body.style.overflow = '';
    setPressed(false);
    phoneBtn.focus();
  }

  /* Captured and stopped, so one press leaves the preview and nothing else. */
  function onKey(e) { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); } }

  let bezel = null;
  function fit() {
    if (!bezel) return;
    const scale = Math.max(0.35, Math.min(1,
      (window.innerHeight - 140) / (FRAME_H + 24),
      (window.innerWidth - 28) / (FRAME_W + 24)));
    bezel.style.transform = `scale(${scale})`;
  }

  function open() {
    if (stage) return;
    const url = new URL(location.href);
    url.searchParams.set('frame', '1');
    const frame = h('iframe', {
      class: 'devframe',
      title: `${appName} at phone size`,
      src: url.toString(),
      width: String(FRAME_W),
      height: String(FRAME_H),
      loading: 'eager',
    });
    bezel = h('div', { class: 'devbezel' }, frame);
    const back = h('button', { class: 'btn', type: 'button' }, 'Back to desktop');
    back.addEventListener('click', close);

    stage = h('div', { class: 'devstage', role: 'dialog', 'aria-modal': 'true', 'aria-label': `${appName} phone preview` },
      h('div', { class: 'devstage__head' },
        h('div', {},
          h('div', { class: 'devstage__name' }, appName),
          h('div', { class: 'devstage__sub mono' }, `${FRAME_W} × ${FRAME_H} · live app, real breakpoints`)),
        back),
      h('div', { class: 'devstage__body' }, bezel));

    document.body.appendChild(stage);
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', fit);
    fit();
    setPressed(true);
    setTimeout(() => back.focus(), 30);
  }

  phoneBtn.addEventListener('click', open);
  deskBtn.addEventListener('click', close);
  return group;
}

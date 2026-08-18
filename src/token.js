/* ============================================================
   slotly — the token slip.
   Shown the moment a booking is made, from the calendar, the booking
   dialog or the desk agent, and again on demand from any booking row.
   Plain teal ground, white type, the token large enough to read
   across a counter. The download is drawn here on a canvas and saved
   as a PNG — no library, no network, nothing leaves the browser.
   ============================================================ */

import { h, toast } from '../lib/ui.js';
import { t } from './main.js';
import {
  dayLabel, hm12, relativeDay, svcOf, staffOf, custOf, tokenLabel, toMin, toHM,
  deskName, branchName, svcName,
} from './data.js';

const CLOSE_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg>';
const DOWN_SVG = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v9M6.5 8.5L10 12l3.5-3.5"/><path d="M3.5 15.5h13"/></svg>';

/* The slip's two colours, matching --amber-fill and --on-amber in the CSS.
   The fill is a dark ground, so what is drawn on it is white, not ink. */
const SLIP_BG = '#0B7D74';
const SLIP_FG = '#FFFFFF';

/** Everything the slip prints, read once so the popup and the PNG agree. */
function slipData(state, b) {
  const svc = svcOf(state, b.serviceId);
  return {
    token: tokenLabel(state, b),
    ref: b.ref,
    desk: deskName(state),
    branch: branchName(state),
    rows: [
      [t('token.rows.customer'), custOf(state, b.customerId).name],
      [t('token.rows.service'), svcName(svc)],
      [t('token.rows.with'), staffOf(state, b.staffId).name],
      [t('token.rows.date'), dayLabel(b.date)],
      [t('token.rows.time'), `${hm12(b.time)} — ${hm12(toHM(toMin(b.time) + b.blockMin))}`],
    ],
  };
}

/* ---------- the PNG ---------- */
/**
 * Draws the slip at 1080×1350 — big enough to keep on a phone or print, small
 * enough to save instantly. Solid fills only, same teal and same white as the
 * popup on screen.
 */
function drawSlip(data) {
  const W = 1080;
  const H = 1350;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const c = cv.getContext('2d');

  c.fillStyle = SLIP_BG;
  c.fillRect(0, 0, W, H);

  c.strokeStyle = SLIP_FG;
  c.lineWidth = 4;
  c.strokeRect(44, 44, W - 88, H - 88);

  c.fillStyle = SLIP_FG;
  c.textBaseline = 'alphabetic';

  const mono = (size, weight = 500) => `${weight} ${size}px "JetBrains Mono", ui-monospace, monospace`;
  const sans = (size, weight = 600) => `${weight} ${size}px "IBM Plex Sans Arabic", "Inter", system-ui, sans-serif`;
  /* The slip is a printed object, so the label column has to sit on whichever
     edge the reader's script starts from — otherwise every row hangs off the
     wrong side of the rule. */
  const rtl = document.documentElement.dir === 'rtl';
  if (rtl) c.direction = 'rtl';

  /* header */
  c.textAlign = 'center';
  c.font = mono(26, 600);
  c.fillText(t('token.slipTitle'), W / 2, 132);
  c.font = sans(34, 700);
  c.fillText(data.desk, W / 2, 190);
  c.font = sans(24, 500);
  c.fillText(data.branch, W / 2, 232);

  /* the number */
  c.font = rtl ? sans(30, 600) : mono(28, 600);
  c.fillText(t('token.slipToken'), W / 2, 330);
  c.font = mono(232, 700);
  c.fillText(data.token, W / 2, 520);
  c.font = mono(40, 500);
  c.fillText(data.ref, W / 2, 588);

  c.beginPath();
  c.moveTo(120, 648);
  c.lineTo(W - 120, 648);
  c.lineWidth = 3;
  c.stroke();

  /* the detail rows */
  c.textAlign = rtl ? 'right' : 'left';
  const edge = rtl ? W - 120 : 120;
  let y = 728;
  for (const [label, value] of data.rows) {
    c.font = rtl ? sans(26, 600) : mono(24, 600);
    c.fillText(rtl ? label : label.toUpperCase(), edge, y);
    c.font = sans(40, 600);
    const text = fit(c, String(value), W - 240);
    c.fillText(text, edge, y + 52);
    y += 116;
  }

  /* footer */
  c.textAlign = 'center';
  c.font = rtl ? sans(26, 500) : mono(24, 500);
  c.fillText(t('token.slipFoot'), W / 2, H - 122);
  c.font = mono(22, 500);
  c.fillText(t('token.slipBuild'), W / 2, H - 80);

  return cv;
}

/** Trim a value to the width available rather than letting it run off the slip. */
function fit(c, text, max) {
  if (c.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 4 && c.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

async function downloadSlip(data) {
  try { if (document.fonts && document.fonts.ready) await document.fonts.ready; } catch (_) { /* fonts are optional */ }
  const cv = drawSlip(data);
  await new Promise((resolve) => {
    cv.toBlob((blob) => {
      if (!blob) { toast(t('token.drawFailed'), 'bad'); resolve(); return; }
      const url = URL.createObjectURL(blob);
      const a = h('a', { href: url, download: `slotly-token-${data.token}-${data.ref}.png` });
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast(t('token.saved', { file: `slotly-token-${data.token}.png` }), 'ok');
      resolve();
    }, 'image/png');
  });
}

/* ---------- the popup ---------- */
/**
 * @param ctx   app context (used only to read the live state)
 * @param b     the booking record
 * @param opts  { title } — "Booked", "Moved" or the default reprint title
 */
export function openToken(ctx, b, opts = {}) {
  if (!b) return null;
  const state = ctx.state;
  const rec = state.bookings.find((x) => x.id === b.id) || b;
  const data = slipData(state, rec);
  const titleId = `tok-${rec.id}`;
  const returnTo = document.activeElement;

  const closeBtn = h('button', {
    class: 'tokenpop__x', type: 'button',
    'aria-label': t('token.close'), title: t('token.closeShort'),
    html: CLOSE_SVG,
  });
  const dlBtn = h('button', {
    class: 'btn tokenpop__dl', type: 'button',
    title: t('token.downloadTitle'),
    html: `${DOWN_SVG}<span>${t('token.download')}</span>`,
  });
  const doneBtn = h('button', { class: 'btn tokenpop__done', type: 'button' }, t('token.done'));

  const box = h('div', {
    class: 'tokenpop', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId,
  },
  h('div', { class: 'tokenpop__head' },
    h('span', { class: 'tokenpop__eyebrow' }, opts.title || t('token.eyebrow')),
    closeBtn),
  h('div', { class: 'tokenpop__label' }, t('token.yourToken')),
  h('div', { class: 'tokenpop__num', id: titleId, dir: 'ltr' }, data.token),
  h('div', { class: 'tokenpop__ref', dir: 'ltr' }, data.ref),
  h('dl', { class: 'tokenpop__kv' }, data.rows.flatMap(([k, v]) => [
    h('dt', {}, k),
    h('dd', {}, v),
  ])),
  h('p', { class: 'tokenpop__note' }, t('token.note', { desk: data.desk })),
  h('div', { class: 'tokenpop__foot' }, dlBtn, doneBtn));

  const scrim = h('div', { class: 'tokscrim' }, box);

  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    scrim.remove();
    if (returnTo && document.contains(returnTo) && returnTo.focus) returnTo.focus();
  };

  function onKey(e) {
    /* Captured, and stopped here: the slip can be opened from inside the
       assistant panel, which also closes itself on Escape. One press should
       only ever shut the thing on top. */
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...box.querySelectorAll('button')].filter((el) => !el.disabled);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  closeBtn.addEventListener('click', close);
  doneBtn.addEventListener('click', close);
  dlBtn.addEventListener('click', async () => {
    dlBtn.disabled = true;
    const span = dlBtn.querySelector('span');
    const was = span.textContent;
    span.textContent = t('token.saving');
    await downloadSlip(data);
    span.textContent = was;
    dlBtn.disabled = false;
    dlBtn.focus();
  });
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey, true);

  document.body.appendChild(scrim);
  setTimeout(() => dlBtn.focus(), 30);
  return { close };
}

/** A small "Token" control for a booking row — the popup is never one-time. */
export function tokenButton(ctx, b, { small = true, label = null } = {}) {
  const btn = h('button', {
    class: `btn${small ? ' btn--sm' : ''}`,
    type: 'button',
    'aria-label': t('token.buttonAria', { ref: b.ref }),
    title: t('token.buttonTitle', { token: tokenLabel(ctx.state, b) }),
  }, label || t('token.button'));
  btn.addEventListener('click', () => openToken(ctx, b, { title: t('bookings.tokenTitle', { day: relativeDay(b.date) }) }));
  return btn;
}

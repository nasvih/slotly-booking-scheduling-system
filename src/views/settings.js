/* Settings — opening hours, slot length and the message templates. */

import { h, icon, toast, confirmDialog } from '../../lib/ui.js';
import {
  DOW, DOW_LONG, hm12, toMin, todayKey, gridSlots, renderTemplate, templateVars,
  TEMPLATE_KEYS, custOf, STORE_KEY,
} from '../data.js';

const TEMPLATES = [
  { key: 'confirmTemplate', label: 'Booking confirmation', when: 'Sent the moment a slot is taken' },
  { key: 'reminderTemplate', label: 'Day-before reminder', when: 'Sent the evening before the appointment' },
  { key: 'cancelTemplate', label: 'Cancellation notice', when: 'Sent when the desk releases a slot' },
];

export default function renderSettings(ctx) {
  const s = ctx.state;
  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, 'Settings'),
      h('p', {}, 'Opening hours and slot length shape the calendar grid. The message templates below are previewed against a real booking from the sample data.'))));

  /* ---------- desk ---------- */
  const f = {};
  const input = (key, label, attrs) => {
    const el = h('input', Object.assign({ class: 'input', value: s.settings[key], 'aria-label': label }, attrs || {}));
    f[key] = el;
    return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), el);
  };

  const slotSel = h('select', { class: 'select', 'aria-label': 'Slot length' },
    [15, 20, 30, 45, 60].map((n) => h('option', { value: n, selected: s.settings.slotMinutes === n }, `${n} minutes`)));
  f.slotMinutes = slotSel;

  const closed = [...s.settings.closedDays];
  const closedPick = h('div', { class: 'daypicker', role: 'group', 'aria-label': 'Days the desk is closed' },
    [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = h('button', {
        type: 'button',
        class: closed.includes(d) ? 'is-on' : '',
        'aria-pressed': String(closed.includes(d)),
        'aria-label': `${DOW_LONG[d]} ${closed.includes(d) ? 'closed' : 'open'}`,
      }, DOW[d]);
      b.addEventListener('click', () => {
        const i = closed.indexOf(d);
        if (i >= 0) closed.splice(i, 1); else closed.push(d);
        b.classList.toggle('is-on');
        b.setAttribute('aria-pressed', String(closed.includes(d)));
      });
      return b;
    }));

  const gridNote = h('p', { class: 'hint' }, `${gridSlots(s).length} slots per open day right now.`);

  const saveDesk = h('button', { class: 'btn btn--primary' }, 'Save desk settings');
  saveDesk.addEventListener('click', () => {
    if (toMin(f.closeTime.value) <= toMin(f.openTime.value)) { toast('Closing time must be after opening time', 'bad'); return; }
    ctx.store.update((d) => {
      Object.assign(d.settings, {
        deskName: f.deskName.value.trim() || d.settings.deskName,
        branch: f.branch.value.trim() || d.settings.branch,
        tokenPrefix: (f.tokenPrefix.value.trim() || 'A').slice(0, 2).toUpperCase(),
        openTime: f.openTime.value || d.settings.openTime,
        closeTime: f.closeTime.value || d.settings.closeTime,
        slotMinutes: Number(slotSel.value) || 30,
        closedDays: [...closed].sort(),
      });
    });
    toast('Desk settings saved', 'ok');
  });

  wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:18px' },
    h('div', { class: 'card__head' }, h('h3', {}, 'Desk'),
      h('span', { class: 'pill' }, `${s.staff.filter((x) => x.active).length} staff`)),
    h('div', { class: 'fieldrow' },
      input('deskName', 'Desk name'),
      input('branch', 'Branch line')),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      input('openTime', 'Opens', { type: 'time', step: '900' }),
      input('closeTime', 'Closes', { type: 'time', step: '900' })),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Slot length'), slotSel, gridNote),
      input('tokenPrefix', 'Token prefix', { maxlength: '2' })),
    h('div', { class: 'field', style: 'margin-top:14px' },
      h('span', { class: 'field__label' }, 'Closed days'), closedPick,
      h('p', { class: 'hint' }, 'A closed day is greyed out on the calendar and cannot take a booking.')),
    h('div', { style: 'margin-top:16px' }, saveDesk)));

  /* ---------- templates ---------- */
  const sample = s.bookings
    .filter((b) => b.date >= todayKey() && b.status === 'booked')
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))[0] || s.bookings[0];
  const vars = templateVars(s, sample);

  const tplBox = h('div', { class: 'stack' });
  const previewBox = h('div', { class: 'msgprev' },
    h('div', { class: 'label', style: 'margin-bottom:10px' }, 'Live preview'),
    h('p', { class: 'small muted', style: 'margin-bottom:12px' },
      sample
        ? `Rendered against ${sample.ref} — ${custOf(s, sample.customerId).name}.`
        : 'Rendered against a sample booking.'));

  const bubbles = {};
  TEMPLATES.forEach((t) => {
    const b = h('div', { class: 'bubble' },
      h('div', { class: 'bubble__from' }, `${t.label} · to ${vars.name}`),
      h('span', {}, renderTemplate(s.settings[t.key], vars)));
    bubbles[t.key] = b.querySelector('span');
    previewBox.appendChild(b);
  });

  TEMPLATES.forEach((t) => {
    const area = h('textarea', { class: 'textarea', 'aria-label': t.label }, s.settings[t.key]);
    area.addEventListener('input', () => { bubbles[t.key].textContent = renderTemplate(area.value, vars); });
    f[t.key] = area;

    const chips = h('div', { class: 'tokchips' }, TEMPLATE_KEYS.map((k) => {
      const c = h('button', { type: 'button', class: 'tokchip', 'aria-label': `Insert ${k} placeholder into ${t.label}` }, `{{${k}}}`);
      c.addEventListener('click', () => {
        const pos = area.selectionStart === null ? area.value.length : area.selectionStart;
        area.value = `${area.value.slice(0, pos)}{{${k}}}${area.value.slice(area.selectionEnd || pos)}`;
        area.dispatchEvent(new Event('input'));
        area.focus();
      });
      return c;
    }));

    tplBox.appendChild(h('div', { class: 'field' },
      h('span', { class: 'field__label' }, t.label),
      h('p', { class: 'hint', style: 'margin:0 0 6px' }, t.when),
      area, chips));
  });

  const saveTpl = h('button', { class: 'btn btn--primary', style: 'margin-top:16px' }, 'Save templates');
  saveTpl.addEventListener('click', () => {
    ctx.store.update((d) => {
      TEMPLATES.forEach((t) => { d.settings[t.key] = f[t.key].value; });
    });
    toast('Templates saved', 'ok');
  });
  tplBox.appendChild(saveTpl);

  wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:18px' },
    h('div', { class: 'card__head' }, h('h3', {}, 'Messages')),
    h('div', { class: 'tplgrid' }, tplBox, previewBox)));

  /* ---------- data ---------- */
  const reset = h('button', { class: 'btn btn--danger', html: `${icon('refresh')}<span>Reset demo data</span>` });
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog(
      'Every booking, service, rota change and note goes back to the generated sample set.',
      { title: 'Reset demo data', danger: true, okLabel: 'Reset' });
    if (!ok) return;
    ctx.store.reset();
    toast('Demo data reset', 'ok');
  });

  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', {}, 'Demo data')),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Bookings'), h('dd', { class: 'mono' }, String(s.bookings.length)),
      h('dt', {}, 'Customers'), h('dd', { class: 'mono' }, String(s.customers.length)),
      h('dt', {}, 'Services'), h('dd', { class: 'mono' }, String(s.services.length)),
      h('dt', {}, 'Stored in'), h('dd', { class: 'mono' }, `localStorage · ${STORE_KEY}`),
      h('dt', {}, 'Opening today'), h('dd', {}, `${hm12(s.settings.openTime)} to ${hm12(s.settings.closeTime)}`)),
    h('p', { class: 'hint', style: 'margin-top:12px' },
      'Nothing leaves this browser. There is no server behind this build and no request is made to one.'),
    h('div', { style: 'margin-top:14px' }, reset)));

  return wrap;
}

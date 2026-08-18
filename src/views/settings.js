/* Settings — opening hours, slot length and the message templates. */

import { h, icon, toast, confirmDialog } from '../../lib/ui.js';
import {
  dow, dowLong, hm12, toMin, todayKey, gridSlots, renderTemplate, templateVars,
  TEMPLATE_KEYS, custOf, STORE_KEY, deskName, branchName, templateText,
} from '../data.js';
import { t } from '../main.js';

const TEMPLATES = ['confirmTemplate', 'reminderTemplate', 'cancelTemplate'];

export default function renderSettings(ctx) {
  const s = ctx.state;
  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, t('settings.title')),
      h('p', {}, t('settings.lede')))));

  /* ---------- desk ---------- */
  const f = {};
  const settingValue = (key) => (key === 'deskName' ? deskName(s) : key === 'branch' ? branchName(s) : s.settings[key]);
  const input = (key, label, attrs) => {
    const el = h('input', Object.assign({ class: 'input', value: settingValue(key), 'aria-label': label }, attrs || {}));
    f[key] = el;
    return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), el);
  };

  const slotSel = h('select', { class: 'select', 'aria-label': t('settings.slotLength') },
    [15, 20, 30, 45, 60].map((n) => h('option', { value: n, selected: s.settings.slotMinutes === n }, t('settings.slotOption', { n }))));
  f.slotMinutes = slotSel;

  const closed = [...s.settings.closedDays];
  const closedPick = h('div', { class: 'daypicker', role: 'group', 'aria-label': t('settings.closedDaysAria') },
    [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = h('button', {
        type: 'button',
        class: closed.includes(d) ? 'is-on' : '',
        'aria-pressed': String(closed.includes(d)),
        'aria-label': t('settings.closedDayAria', { day: dowLong(d), closed: closed.includes(d) }),
      }, dow(d));
      b.addEventListener('click', () => {
        const i = closed.indexOf(d);
        if (i >= 0) closed.splice(i, 1); else closed.push(d);
        b.classList.toggle('is-on');
        b.setAttribute('aria-pressed', String(closed.includes(d)));
      });
      return b;
    }));

  const gridNote = h('p', { class: 'hint' }, t('settings.gridNote', { n: gridSlots(s).length }));

  const saveDesk = h('button', { class: 'btn btn--primary' }, t('settings.saveDesk'));
  saveDesk.addEventListener('click', () => {
    if (toMin(f.closeTime.value) <= toMin(f.openTime.value)) { toast(t('settings.closeAfterOpen'), 'bad'); return; }
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
    toast(t('settings.deskSaved'), 'ok');
  });

  wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:18px' },
    h('div', { class: 'card__head' }, h('h3', {}, t('settings.desk')),
      h('span', { class: 'pill' }, t('settings.staffPill', { n: s.staff.filter((x) => x.active).length }))),
    h('div', { class: 'fieldrow' },
      input('deskName', t('settings.deskName')),
      input('branch', t('settings.branch'))),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      input('openTime', t('settings.opens'), { type: 'time', step: '900' }),
      input('closeTime', t('settings.closes'), { type: 'time', step: '900' })),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, t('settings.slotLength')), slotSel, gridNote),
      input('tokenPrefix', t('settings.tokenPrefix'), { maxlength: '2' })),
    h('div', { class: 'field', style: 'margin-top:14px' },
      h('span', { class: 'field__label' }, t('settings.closedDays')), closedPick,
      h('p', { class: 'hint' }, t('settings.closedHint'))),
    h('div', { style: 'margin-top:16px' }, saveDesk)));

  /* ---------- templates ---------- */
  const sample = s.bookings
    .filter((b) => b.date >= todayKey() && b.status === 'booked')
    .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)))[0] || s.bookings[0];
  const vars = templateVars(s, sample);

  const tplBox = h('div', { class: 'stack' });
  const previewBox = h('div', { class: 'msgprev' },
    h('div', { class: 'label', style: 'margin-bottom:10px' }, t('settings.livePreview')),
    h('p', { class: 'small muted', style: 'margin-bottom:12px' },
      sample
        ? t('settings.renderedAgainst', { ref: sample.ref, name: custOf(s, sample.customerId).name })
        : t('settings.renderedSample')));

  const bubbles = {};
  TEMPLATES.forEach((key) => {
    const b = h('div', { class: 'bubble' },
      h('div', { class: 'bubble__from' }, t('settings.bubbleFrom', { label: t(`settings.templates.${key}.label`), name: vars.name })),
      h('span', {}, renderTemplate(templateText(s, key), vars)));
    bubbles[key] = b.querySelector('span');
    previewBox.appendChild(b);
  });

  TEMPLATES.forEach((key) => {
    const label = t(`settings.templates.${key}.label`);
    const area = h('textarea', { class: 'textarea', 'aria-label': label }, templateText(s, key));
    area.addEventListener('input', () => { bubbles[key].textContent = renderTemplate(area.value, vars); });
    f[key] = area;

    const chips = h('div', { class: 'tokchips' }, TEMPLATE_KEYS.map((k) => {
      const c = h('button', { type: 'button', class: 'tokchip', 'aria-label': t('settings.insertAria', { key: k, label }) }, `{{${k}}}`);
      c.addEventListener('click', () => {
        const pos = area.selectionStart === null ? area.value.length : area.selectionStart;
        area.value = `${area.value.slice(0, pos)}{{${k}}}${area.value.slice(area.selectionEnd || pos)}`;
        area.dispatchEvent(new Event('input'));
        area.focus();
      });
      return c;
    }));

    tplBox.appendChild(h('div', { class: 'field' },
      h('span', { class: 'field__label' }, label),
      h('p', { class: 'hint', style: 'margin:0 0 6px' }, t(`settings.templates.${key}.when`)),
      area, chips));
  });

  const saveTpl = h('button', { class: 'btn btn--primary', style: 'margin-top:16px' }, t('settings.saveTemplates'));
  saveTpl.addEventListener('click', () => {
    ctx.store.update((d) => {
      TEMPLATES.forEach((key) => { d.settings[key] = f[key].value; });
    });
    toast(t('settings.templatesSaved'), 'ok');
  });
  tplBox.appendChild(saveTpl);

  wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:18px' },
    h('div', { class: 'card__head' }, h('h3', {}, t('settings.messages'))),
    h('div', { class: 'tplgrid' }, tplBox, previewBox)));

  /* ---------- data ---------- */
  const reset = h('button', { class: 'btn btn--danger', html: `${icon('refresh')}<span>${t('nav.reset')}</span>` });
  reset.addEventListener('click', async () => {
    const ok = await confirmDialog(
      t('settings.resetBody'),
      { title: t('nav.reset'), danger: true, okLabel: t('common.reset') });
    if (!ok) return;
    ctx.store.reset();
    toast(t('common.demoReset'), 'ok');
  });

  wrap.appendChild(h('div', { class: 'card' },
    h('div', { class: 'card__head' }, h('h3', {}, t('settings.demoData'))),
    h('dl', { class: 'kv' },
      h('dt', {}, t('settings.kv.bookings')), h('dd', { class: 'mono' }, String(s.bookings.length)),
      h('dt', {}, t('settings.kv.customers')), h('dd', { class: 'mono' }, String(s.customers.length)),
      h('dt', {}, t('settings.kv.services')), h('dd', { class: 'mono' }, String(s.services.length)),
      h('dt', {}, t('settings.kv.storedIn')), h('dd', { class: 'mono' }, `localStorage · ${STORE_KEY}`),
      h('dt', {}, t('settings.kv.openingToday')), h('dd', {}, t('settings.openingLine', { from: hm12(s.settings.openTime), to: hm12(s.settings.closeTime) }))),
    h('p', { class: 'hint', style: 'margin-top:12px' }, t('settings.noServer')),
    h('div', { style: 'margin-top:14px' }, reset)));

  return wrap;
}

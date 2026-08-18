/* Services — duration, buffer, price and whether the desk still offers it. */

import { h, icon, modal, toast, money, barChart } from '../../lib/ui.js';
import { todayKey, addDays, svcName } from '../data.js';
import { t } from '../main.js';

function serviceForm(ctx, existing) {
  const s = ctx.state;
  const v = existing || { name: '', code: '', durationMin: 30, bufferMin: 10, priceInr: 500, active: true };
  const f = {};
  const field = (key, label, attrs) => {
    const input = h('input', Object.assign({ class: 'input', value: v[key] }, attrs || {}));
    f[key] = input;
    return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), input);
  };

  const body = h('div', {},
    field('name', t('services.fields.name'), { placeholder: t('services.namePlaceholder') }),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      field('code', t('services.fields.code'), { placeholder: t('services.codePlaceholder'), maxlength: '4' }),
      field('priceInr', t('services.fields.price'), { type: 'number', min: '0', step: '50' })),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      field('durationMin', t('services.fields.duration'), { type: 'number', min: '5', step: '5' }),
      field('bufferMin', t('services.fields.buffer'), { type: 'number', min: '0', step: '5' })),
    h('p', { class: 'hint' }, t('services.formHint', { step: s.settings.slotMinutes })));

  modal({
    title: existing ? t('services.editTitle', { name: svcName(existing) }) : t('services.newService'),
    body,
    actions: [
      { label: t('common.cancel') },
      {
        label: existing ? t('services.saveService') : t('services.addService'),
        class: 'btn--primary',
        onClick: () => {
          const name = f.name.value.trim();
          if (!name) { toast(t('services.needName'), 'bad'); return true; }
          const patch = {
            name,
            code: (f.code.value.trim() || name.slice(0, 3)).toUpperCase(),
            durationMin: Math.max(5, Number(f.durationMin.value) || 15),
            bufferMin: Math.max(0, Number(f.bufferMin.value) || 0),
            priceInr: Math.max(0, Number(f.priceInr.value) || 0),
          };
          ctx.store.update((draft) => {
            if (existing) Object.assign(draft.services.find((x) => x.id === existing.id), patch);
            else draft.services.push(Object.assign({ id: `svc-${Math.random().toString(36).slice(2, 7)}`, active: true }, patch));
          });
          toast(existing ? t('services.updated') : t('services.added', { name: patch.name }), 'ok');
          return false;
        },
      },
    ],
  });
}

export default function renderServices(ctx) {
  const s = ctx.state;
  const from = addDays(todayKey(), -30);
  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, t('services.title')),
      h('p', {}, t('services.lede'))),
    (() => {
      const b = h('button', { class: 'btn btn--primary', html: `${icon('plus')}<span>${t('services.newService')}</span>` });
      b.addEventListener('click', () => serviceForm(ctx, null));
      return b;
    })()));

  const stats = s.services.map((svc) => {
    const list = s.bookings.filter((b) => b.serviceId === svc.id && b.date >= from && b.date <= todayKey() && b.status === 'done');
    return { svc, count: list.length, revenue: list.length * svc.priceInr };
  }).sort((a, b) => b.revenue - a.revenue);

  wrap.appendChild(h('div', { class: 'grid g3', style: 'margin-bottom:18px' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('services.bookable')),
      h('div', { class: 'stat__value' }, String(s.services.filter((x) => x.active).length)),
      h('div', { class: 'stat__delta' }, t('services.definedTotal', { n: s.services.length }))),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('services.billed30')),
      h('div', { class: 'stat__value' }, money(stats.reduce((n, x) => n + x.revenue, 0), s.settings.currency)),
      h('div', { class: 'stat__delta' }, t('services.completed30', { n: stats.reduce((n, x) => n + x.count, 0) }))),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('services.longest')),
      h('div', { class: 'stat__value' }, t('common.minShort', { n: Math.max(...s.services.map((x) => x.durationMin + x.bufferMin)) })),
      h('div', { class: 'stat__delta' }, t('services.longestSub')))));

  wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:18px' },
    h('div', { class: 'card__head' }, h('h3', {}, t('services.chartHead'))),
    barChart(stats.map((x) => ({ label: x.svc.code, value: x.count })), { muted: (x) => x.value === 0 })));

  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {},
      t('services.cols').map((c) => h('th', { class: t('services.rightCols').includes(c) ? 'right' : '' }, c)))),
    h('tbody', {}, stats.map(({ svc, count, revenue }) => {
      const toggle = h('input', { type: 'checkbox', checked: svc.active, 'aria-label': t('services.toggleAria', { name: svcName(svc) }) });
      toggle.addEventListener('change', () => {
        ctx.store.update((draft) => {
          const rec = draft.services.find((x) => x.id === svc.id);
          rec.active = toggle.checked;
        });
        toast(toggle.checked ? t('services.isBookable', { name: svcName(svc) }) : t('services.isOff', { name: svcName(svc) }), toggle.checked ? 'ok' : '');
      });
      const edit = h('button', { class: 'btn btn--sm', 'aria-label': t('services.editAria', { name: svcName(svc) }) }, t('common.edit'));
      edit.addEventListener('click', () => serviceForm(ctx, svc));

      return h('tr', {},
        h('td', {}, h('div', { style: 'font-weight:600' }, svcName(svc)),
          h('div', { class: 'small faint' }, t('services.takers', { n: s.staff.filter((st) => st.skills.includes(svc.id)).length }))),
        h('td', { class: 'mono' }, svc.code),
        h('td', { class: 'mono' }, t('common.minShort', { n: svc.durationMin })),
        h('td', { class: 'mono' }, t('common.minShort', { n: svc.bufferMin })),
        h('td', { class: 'mono' }, t('common.minShort', { n: svc.durationMin + svc.bufferMin })),
        h('td', { class: 'right mono' }, money(svc.priceInr, s.settings.currency)),
        h('td', { class: 'right mono' }, String(count)),
        h('td', { class: 'right mono' }, money(revenue, s.settings.currency)),
        h('td', {}, h('label', { class: 'switch' }, toggle, h('span', { class: 'switch__track' }),
          h('span', { class: 'small' }, svc.active ? t('common.on') : t('common.off')))),
        h('td', { class: 'right' }, edit));
    })));

  wrap.appendChild(h('div', { class: 'tablewrap tablewrap--scroll' }, table));
  return wrap;
}

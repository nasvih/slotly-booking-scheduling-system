/* Services — duration, buffer, price and whether the desk still offers it. */

import { h, icon, modal, toast, money, barChart } from '../../lib/ui.js';
import { todayKey, addDays } from '../data.js';

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
    field('name', 'Service name', { placeholder: 'Dental check-up' }),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      field('code', 'Short code', { placeholder: 'DEN', maxlength: '4' }),
      field('priceInr', 'Price', { type: 'number', min: '0', step: '50' })),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      field('durationMin', 'Duration (minutes)', { type: 'number', min: '5', step: '5' }),
      field('bufferMin', 'Buffer after (minutes)', { type: 'number', min: '0', step: '5' })),
    h('p', { class: 'hint' }, `Duration plus buffer is the block the calendar reserves. The grid runs in ${s.settings.slotMinutes} minute steps, so a block is rounded up to the next step.`));

  modal({
    title: existing ? `Edit ${existing.name}` : 'New service',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: existing ? 'Save service' : 'Add service',
        class: 'btn--primary',
        onClick: () => {
          const name = f.name.value.trim();
          if (!name) { toast('Give the service a name', 'bad'); return true; }
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
          toast(existing ? 'Service updated' : `${patch.name} added`, 'ok');
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
      h('h1', {}, 'Services'),
      h('p', {}, 'What the desk can book. Turning a service off keeps its history but takes it out of the booking dialog and off the calendar.')),
    (() => {
      const b = h('button', { class: 'btn btn--primary', html: `${icon('plus')}<span>New service</span>` });
      b.addEventListener('click', () => serviceForm(ctx, null));
      return b;
    })()));

  const stats = s.services.map((svc) => {
    const list = s.bookings.filter((b) => b.serviceId === svc.id && b.date >= from && b.date <= todayKey() && b.status === 'done');
    return { svc, count: list.length, revenue: list.length * svc.priceInr };
  }).sort((a, b) => b.revenue - a.revenue);

  wrap.appendChild(h('div', { class: 'grid g3', style: 'margin-bottom:18px' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Bookable services'),
      h('div', { class: 'stat__value' }, String(s.services.filter((x) => x.active).length)),
      h('div', { class: 'stat__delta' }, `${s.services.length} defined in total`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Billed last 30 days'),
      h('div', { class: 'stat__value' }, money(stats.reduce((n, x) => n + x.revenue, 0), s.settings.currency)),
      h('div', { class: 'stat__delta' }, `${stats.reduce((n, x) => n + x.count, 0)} completed appointments`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Longest block'),
      h('div', { class: 'stat__value' }, `${Math.max(...s.services.map((x) => x.durationMin + x.bufferMin))}m`),
      h('div', { class: 'stat__delta' }, 'Duration plus buffer'))));

  wrap.appendChild(h('div', { class: 'card', style: 'margin-bottom:18px' },
    h('div', { class: 'card__head' }, h('h3', {}, 'Completed appointments by service, last 30 days')),
    barChart(stats.map((x) => ({ label: x.svc.code, value: x.count })), { muted: (x) => x.value === 0 })));

  const table = h('table', { class: 'data' },
    h('thead', {}, h('tr', {},
      ['Service', 'Code', 'Duration', 'Buffer', 'Block', 'Price', 'Done 30d', 'Billed 30d', 'Bookable', ''].map((c) => h('th', { class: /Price|Done|Billed/.test(c) ? 'right' : '' }, c)))),
    h('tbody', {}, stats.map(({ svc, count, revenue }) => {
      const toggle = h('input', { type: 'checkbox', checked: svc.active, 'aria-label': `${svc.name} bookable` });
      toggle.addEventListener('change', () => {
        ctx.store.update((draft) => {
          const rec = draft.services.find((x) => x.id === svc.id);
          rec.active = toggle.checked;
        });
        toast(`${svc.name} ${toggle.checked ? 'is bookable' : 'is off the menu'}`, toggle.checked ? 'ok' : '');
      });
      const edit = h('button', { class: 'btn btn--sm', 'aria-label': `Edit ${svc.name}` }, 'Edit');
      edit.addEventListener('click', () => serviceForm(ctx, svc));

      return h('tr', {},
        h('td', {}, h('div', { style: 'font-weight:600' }, svc.name),
          h('div', { class: 'small faint' }, `${s.staff.filter((st) => st.skills.includes(svc.id)).length} staff can take it`)),
        h('td', { class: 'mono' }, svc.code),
        h('td', { class: 'mono' }, `${svc.durationMin}m`),
        h('td', { class: 'mono' }, `${svc.bufferMin}m`),
        h('td', { class: 'mono' }, `${svc.durationMin + svc.bufferMin}m`),
        h('td', { class: 'right mono' }, money(svc.priceInr, s.settings.currency)),
        h('td', { class: 'right mono' }, String(count)),
        h('td', { class: 'right mono' }, money(revenue, s.settings.currency)),
        h('td', {}, h('label', { class: 'switch' }, toggle, h('span', { class: 'switch__track' }),
          h('span', { class: 'small' }, svc.active ? 'On' : 'Off'))),
        h('td', { class: 'right' }, edit));
    })));

  wrap.appendChild(h('div', { class: 'tablewrap tablewrap--scroll' }, table));
  return wrap;
}

/* Today — the live token queue for the current day. */

import { h, icon, toast, meter, pct } from '../../lib/ui.js';
import {
  todayKey, dayLabel, hm12, bookingsOn, svcOf, staffOf, custOf, tokenLabel,
  STATUS, utilisation, customerStats, isOpenDay, toMin,
} from '../data.js';
import { openBooking, openReschedule, cancelBooking, setStatus } from '../booking.js';

const FILTERS = [
  { id: 'all', label: 'Everyone' },
  { id: 'open', label: 'Waiting' },
  { id: 'done', label: 'Served' },
  { id: 'miss', label: 'No-show' },
  { id: 'cancelled', label: 'Cancelled' },
];

let filter = 'all';

function statusOfRow(b) {
  if (b.status === 'serving') return 'qrow--now';
  if (b.status === 'done') return 'qrow--done';
  if (b.status === 'no-show') return 'qrow--miss';
  return '';
}

function actions(ctx, b) {
  const btn = (label, kind, fn, aria) => {
    const el = h('button', { class: `btn btn--sm ${kind}`, 'aria-label': aria || null }, label);
    el.addEventListener('click', fn);
    return el;
  };
  const row = h('div', { class: 'qacts' });
  const name = custOf(ctx.state, b.customerId).name;

  if (b.status === 'booked') {
    row.appendChild(btn('Call', 'btn--primary', () => {
      setStatus(ctx, b, 'called', 'Called to the desk');
      toast(`Called ${tokenLabel(ctx.state, b)} — ${name}`, 'ok');
    }, `Call ${name}`));
    row.appendChild(btn('Serving', '', () => setStatus(ctx, b, 'serving', 'Started service'), `Start serving ${name}`));
  }
  if (b.status === 'called') {
    row.appendChild(btn('Start', 'btn--primary', () => setStatus(ctx, b, 'serving', 'Started service'), `Start serving ${name}`));
    row.appendChild(btn('Call again', '', () => toast(`Called ${tokenLabel(ctx.state, b)} again`, ''), `Call ${name} again`));
  }
  if (b.status === 'serving') {
    row.appendChild(btn('Done', 'btn--primary', () => {
      setStatus(ctx, b, 'done', 'Service finished');
      toast(`${tokenLabel(ctx.state, b)} done`, 'ok');
    }, `Mark ${name} done`));
  }
  if (b.status === 'booked' || b.status === 'called' || b.status === 'serving') {
    row.appendChild(btn('No-show', 'btn--danger', () => {
      setStatus(ctx, b, 'no-show', 'Marked no-show');
      toast(`${tokenLabel(ctx.state, b)} marked no-show`, 'bad');
    }, `Mark ${name} as a no-show`));
    row.appendChild(btn('Move', '', () => openReschedule(ctx, b), `Reschedule ${name}`));
    row.appendChild(btn('Cancel', '', () => cancelBooking(ctx, b), `Cancel booking for ${name}`));
  }
  if (b.status === 'done' || b.status === 'no-show' || b.status === 'cancelled') {
    row.appendChild(btn('Undo', '', () => {
      setStatus(ctx, b, 'booked', 'Put back in the queue');
      toast(`${tokenLabel(ctx.state, b)} back in the queue`, '');
    }, `Put ${name} back in the queue`));
  }
  return row;
}

function queueRow(ctx, b) {
  const svc = svcOf(ctx.state, b.serviceId);
  const st = staffOf(ctx.state, b.staffId);
  const cs = customerStats(ctx.state, b.customerId);
  const s = STATUS[b.status] || STATUS.booked;
  return h('div', { class: `qrow ${statusOfRow(b)}` },
    h('div', { class: 'qtok' },
      h('div', { class: 'qtok__n' }, tokenLabel(ctx.state, b)),
      h('div', { class: 'qtok__t' }, hm12(b.time))),
    h('div', { class: 'qmain' },
      h('div', { class: 'qmain__name' }, custOf(ctx.state, b.customerId).name),
      h('div', { class: 'qmain__sub' },
        `${svc.name} · ${st.name} · ${st.room} · ${b.channel}`,
        cs.rate >= 25 ? h('span', { class: 'pill pill--warn', style: 'margin-left:8px' }, `No-show ${cs.rate}%`) : null)),
    h('span', { class: `pill ${s.pill}` }, s.label),
    actions(ctx, b));
}

export default function renderToday(ctx) {
  const state = ctx.state;
  const key = todayKey();
  const all = bookingsOn(state, key);
  const live = all.filter((b) => b.status !== 'cancelled');
  const waiting = live.filter((b) => b.status === 'booked' || b.status === 'called');
  const serving = live.find((b) => b.status === 'serving');
  const done = live.filter((b) => b.status === 'done');
  const missed = live.filter((b) => b.status === 'no-show');
  const util = utilisation(state, key);
  const takings = done.reduce((n, b) => n + svcOf(state, b.serviceId).priceInr, 0);

  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, dayLabel(key)),
      h('p', {}, isOpenDay(state, key)
        ? `${state.settings.deskName} · ${state.settings.branch} · open ${hm12(state.settings.openTime)} to ${hm12(state.settings.closeTime)}`
        : 'The desk is closed today. Bookings can still be taken for other days.')),
    h('div', { class: 'btnrow' },
      (() => {
        const b = h('button', { class: 'btn', html: `${icon('arrowRight')}<span>Call next</span>` });
        b.addEventListener('click', () => {
          const next = waiting.find((x) => x.status === 'booked');
          if (!next) { toast('Nobody is waiting', ''); return; }
          setStatus(ctx, next, 'called', 'Called to the desk');
          toast(`Called ${tokenLabel(state, next)} — ${custOf(state, next.customerId).name}`, 'ok');
        });
        return b;
      })(),
      (() => {
        const b = h('button', { class: 'btn btn--primary', html: `${icon('plus')}<span>Add to queue</span>` });
        b.addEventListener('click', () => openBooking(ctx, { date: key }));
        return b;
      })())));

  wrap.appendChild(h('div', { class: 'grid g4' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'In the queue'),
      h('div', { class: 'stat__value' }, String(waiting.length)),
      h('div', { class: 'stat__delta' }, `${live.length} booked in total today`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Served'),
      h('div', { class: 'stat__value' }, String(done.length)),
      h('div', { class: 'stat__delta' }, `${state.settings.currency}${takings.toLocaleString('en-IN')} taken`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'No-shows'),
      h('div', { class: 'stat__value' }, String(missed.length)),
      h('div', { class: 'stat__delta' }, missed.length ? 'Slots released back to the grid' : 'None so far today')),
    h('div', { class: 'stat stat--accent' },
      h('div', { class: 'stat__label' }, 'Chair time booked'),
      h('div', { class: 'stat__value' }, pct(util.pct)),
      h('div', { class: 'stat__delta' }, `${util.used} of ${util.capacity} minutes across ${state.staff.filter((s) => s.active).length} staff`))));

  wrap.appendChild(h('div', { class: 'nowcard', style: 'margin-top:20px' },
    h('div', {},
      h('div', { class: 'label' }, 'Now serving'),
      h('div', { class: 'tokenbig' }, serving ? tokenLabel(state, serving) : '—')),
    h('div', { class: 'nowcard__body' },
      serving
        ? h('div', {},
          h('div', { style: 'font-weight:600' }, custOf(state, serving.customerId).name),
          h('div', { class: 'small muted' }, `${svcOf(state, serving.serviceId).name} with ${staffOf(state, serving.staffId).name} · started ${hm12(serving.time)}`))
        : h('div', { class: 'small muted' }, 'No one at the chair right now. Call the next token to start.')),
    h('div', { style: 'min-width:180px' },
      h('div', { class: 'label' }, 'Next up'),
      h('div', { class: 'small', style: 'margin-top:4px' },
        waiting.length
          ? `${tokenLabel(state, waiting[0])} · ${custOf(state, waiting[0].customerId).name} at ${hm12(waiting[0].time)}`
          : 'Queue is clear'))));

  /* filter chips */
  const chips = h('div', { class: 'toolbar', style: 'margin-top:20px' },
    FILTERS.map((f) => {
      const count = f.id === 'all' ? all.length
        : f.id === 'open' ? waiting.length + (serving ? 1 : 0)
          : f.id === 'done' ? done.length
            : f.id === 'miss' ? missed.length
              : all.filter((b) => b.status === 'cancelled').length;
      const c = h('button', { class: `chip${filter === f.id ? ' is-on' : ''}`, 'aria-pressed': String(filter === f.id) },
        f.label, h('span', { class: 'mono', style: 'opacity:.75' }, String(count)));
      c.addEventListener('click', () => { filter = f.id; ctx.refresh(); });
      return c;
    }));
  wrap.appendChild(chips);

  const shown = all.filter((b) => {
    if (filter === 'all') return b.status !== 'cancelled';
    if (filter === 'open') return b.status === 'booked' || b.status === 'called' || b.status === 'serving';
    if (filter === 'done') return b.status === 'done';
    if (filter === 'miss') return b.status === 'no-show';
    return b.status === 'cancelled';
  }).sort((a, b) => toMin(a.time) - toMin(b.time));

  if (!shown.length) {
    wrap.appendChild(h('div', { class: 'empty' },
      h('h3', {}, 'Nothing in this list'),
      h('p', { class: 'small' }, 'Change the filter above, or add a booking to today from the button at the top right.')));
  } else {
    wrap.appendChild(h('div', { class: 'queue' }, shown.map((b) => queueRow(ctx, b))));
  }

  /* per-staff load */
  wrap.appendChild(h('div', { class: 'card', style: 'margin-top:22px' },
    h('div', { class: 'card__head' }, h('h3', {}, 'Load per staff member today')),
    h('div', { class: 'stack' }, util.perStaff.map((p) => h('div', {},
      h('div', { class: 'between', style: 'margin-bottom:6px' },
        h('span', { class: 'small' }, `${p.name}${p.capacity ? '' : ' · day off'}`),
        h('span', { class: 'mono small' }, p.capacity ? `${p.booked} / ${p.capacity} min · ${p.pct}%` : '—')),
      h('div', { class: 'loadbar' }, meter(p.booked, p.capacity || 1, p.pct > 90 ? 'bad' : p.pct > 60 ? '' : 'ok')))))));

  return wrap;
}

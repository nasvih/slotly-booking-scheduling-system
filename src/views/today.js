/* Today — the live token queue for the current day. */

import { h, icon, toast, meter, pct } from '../../lib/ui.js';
import {
  todayKey, dayLabel, hm12, bookingsOn, svcOf, staffOf, custOf, tokenLabel,
  STATUS, utilisation, customerStats, isOpenDay, toMin,
  svcName, staffRoom, channelLabel, deskName, branchName,
} from '../data.js';
import { openBooking, openReschedule, cancelBooking, setStatus } from '../booking.js';
import { tokenButton } from '../token.js';
import { t } from '../main.js';

const FILTER_IDS = ['all', 'open', 'done', 'miss', 'cancelled'];

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
    row.appendChild(btn(t('today.act.call'), 'btn--primary', () => {
      setStatus(ctx, b, 'called', 'called');
      toast(t('today.called', { token: tokenLabel(ctx.state, b), name }), 'ok');
    }, t('today.aria.call', { name })));
    row.appendChild(btn(t('today.act.serving'), '', () => setStatus(ctx, b, 'serving', 'started'), t('today.aria.serve', { name })));
  }
  if (b.status === 'called') {
    row.appendChild(btn(t('today.act.start'), 'btn--primary', () => setStatus(ctx, b, 'serving', 'started'), t('today.aria.serve', { name })));
    row.appendChild(btn(t('today.act.callAgain'), '', () => toast(t('today.calledAgain', { token: tokenLabel(ctx.state, b) }), ''), t('today.aria.callAgain', { name })));
  }
  if (b.status === 'serving') {
    row.appendChild(btn(t('today.act.done'), 'btn--primary', () => {
      setStatus(ctx, b, 'done', 'finished');
      toast(t('today.tokenDone', { token: tokenLabel(ctx.state, b) }), 'ok');
    }, t('today.aria.done', { name })));
  }
  if (b.status === 'booked' || b.status === 'called' || b.status === 'serving') {
    row.appendChild(btn(t('today.act.noShow'), 'btn--danger', () => {
      setStatus(ctx, b, 'no-show', 'noShow');
      toast(t('today.tokenMissed', { token: tokenLabel(ctx.state, b) }), 'bad');
    }, t('today.aria.noShow', { name })));
    row.appendChild(btn(t('today.act.move'), '', () => openReschedule(ctx, b), t('today.aria.move', { name })));
    row.appendChild(btn(t('today.act.cancel'), '', () => cancelBooking(ctx, b), t('today.aria.cancel', { name })));
  }
  if (b.status === 'done' || b.status === 'no-show' || b.status === 'cancelled') {
    row.appendChild(btn(t('today.act.undo'), '', () => {
      setStatus(ctx, b, 'booked', 'requeued');
      toast(t('today.tokenBack', { token: tokenLabel(ctx.state, b) }), '');
    }, t('today.aria.undo', { name })));
  }
  /* The slip is never a one-time thing — any row can print it again. */
  if (b.status !== 'cancelled') row.appendChild(tokenButton(ctx, b));
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
        `${svcName(svc)} · ${st.name} · ${staffRoom(st)} · ${channelLabel(b.channel)}`,
        cs.rate >= 25 ? h('span', { class: 'pill pill--warn', style: 'margin-left:8px' }, t('today.noShowPill', { pct: cs.rate })) : null)),
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
        ? t('today.openLine', {
          desk: deskName(state),
          branch: branchName(state),
          from: hm12(state.settings.openTime),
          to: hm12(state.settings.closeTime),
        })
        : t('today.closed'))),
    h('div', { class: 'btnrow' },
      (() => {
        const b = h('button', { class: 'btn', html: `${icon('arrowRight')}<span>${t('today.callNext')}</span>` });
        b.addEventListener('click', () => {
          const next = waiting.find((x) => x.status === 'booked');
          if (!next) { toast(t('today.nobodyWaiting'), ''); return; }
          setStatus(ctx, next, 'called', 'called');
          toast(t('today.called', { token: tokenLabel(state, next), name: custOf(state, next.customerId).name }), 'ok');
        });
        return b;
      })(),
      (() => {
        const b = h('button', { class: 'btn btn--primary', html: `${icon('plus')}<span>${t('today.addQueue')}</span>` });
        b.addEventListener('click', () => openBooking(ctx, { date: key }));
        return b;
      })())));

  wrap.appendChild(h('div', { class: 'grid g4' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('today.inQueue')),
      h('div', { class: 'stat__value' }, String(waiting.length)),
      h('div', { class: 'stat__delta' }, t('today.bookedTotal', { n: live.length }))),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('today.served')),
      h('div', { class: 'stat__value' }, String(done.length)),
      h('div', { class: 'stat__delta' }, t('today.taken', { money: `${state.settings.currency}${takings.toLocaleString('en-IN')}` }))),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('today.noShows')),
      h('div', { class: 'stat__value' }, String(missed.length)),
      h('div', { class: 'stat__delta' }, missed.length ? t('today.released') : t('today.noneYet'))),
    h('div', { class: 'stat stat--accent' },
      h('div', { class: 'stat__label' }, t('today.chairTime')),
      h('div', { class: 'stat__value' }, pct(util.pct)),
      h('div', { class: 'stat__delta' }, t('today.chairSub', {
        used: util.used, capacity: util.capacity, staff: state.staff.filter((s) => s.active).length,
      })))));

  wrap.appendChild(h('div', { class: 'nowcard', style: 'margin-top:20px' },
    h('div', {},
      h('div', { class: 'label' }, t('today.nowServing')),
      h('div', { class: 'tokenbig' }, serving ? tokenLabel(state, serving) : '—')),
    h('div', { class: 'nowcard__body' },
      serving
        ? h('div', {},
          h('div', { style: 'font-weight:600' }, custOf(state, serving.customerId).name),
          h('div', { class: 'small muted' }, t('today.servingLine', {
            service: svcName(svcOf(state, serving.serviceId)),
            staff: staffOf(state, serving.staffId).name,
            time: hm12(serving.time),
          })))
        : h('div', { class: 'small muted' }, t('today.nobodyAtChair'))),
    h('div', { style: 'min-width:180px' },
      h('div', { class: 'label' }, t('today.nextUp')),
      h('div', { class: 'small', style: 'margin-top:4px' },
        waiting.length
          ? t('today.nextLine', {
            token: tokenLabel(state, waiting[0]),
            name: custOf(state, waiting[0].customerId).name,
            time: hm12(waiting[0].time),
          })
          : t('today.queueClear')))));

  /* filter chips */
  const chips = h('div', { class: 'toolbar', style: 'margin-top:20px' },
    FILTER_IDS.map((id) => {
      const count = id === 'all' ? all.length
        : id === 'open' ? waiting.length + (serving ? 1 : 0)
          : id === 'done' ? done.length
            : id === 'miss' ? missed.length
              : all.filter((b) => b.status === 'cancelled').length;
      const c = h('button', { class: `chip${filter === id ? ' is-on' : ''}`, 'aria-pressed': String(filter === id) },
        t(`today.filters.${id}`), h('span', { class: 'mono', style: 'opacity:.75' }, String(count)));
      c.addEventListener('click', () => { filter = id; ctx.refresh(); });
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
      h('h3', {}, t('today.emptyHead')),
      h('p', { class: 'small' }, t('today.emptyBody'))));
  } else {
    wrap.appendChild(h('div', { class: 'queue' }, shown.map((b) => queueRow(ctx, b))));
  }

  /* per-staff load */
  wrap.appendChild(h('div', { class: 'card', style: 'margin-top:22px' },
    h('div', { class: 'card__head' }, h('h3', {}, t('today.loadHead'))),
    h('div', { class: 'stack' }, util.perStaff.map((p) => h('div', {},
      h('div', { class: 'between', style: 'margin-bottom:6px' },
        h('span', { class: 'small' }, `${p.name}${p.capacity ? '' : t('today.dayOff')}`),
        h('span', { class: 'mono small' }, p.capacity ? t('today.loadCell', { booked: p.booked, capacity: p.capacity, pct: p.pct }) : '—')),
      h('div', { class: 'loadbar' }, meter(p.booked, p.capacity || 1, p.pct > 90 ? 'bad' : p.pct > 60 ? '' : 'ok')))))));

  return wrap;
}

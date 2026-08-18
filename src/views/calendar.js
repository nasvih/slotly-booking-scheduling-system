/* Calendar — week grid across the staff resources. Click a free slot to book it. */

import { h, icon, pct } from '../../lib/ui.js';
import {
  todayKey, weekStart, addDays, parseDay, dayLabel, hm12, gridSlots, toMin, deskNowMin,
  isOpenDay, freeStaffAt, staffWorks, nextAvailable, svcOf, staffOf, custOf, tokenLabel, utilisation,
  blocksOn, dow, monthShort, svcName,
} from '../data.js';
import { openBooking } from '../booking.js';
import { t } from '../main.js';

let week = null;
let staffFilter = 'all';
let serviceFilter = '';

export default function renderCalendar(ctx) {
  const state = ctx.state;
  const slotMin = state.settings.slotMinutes;
  const active = state.services.filter((s) => s.active);
  if (!serviceFilter || !active.some((s) => s.id === serviceFilter)) serviceFilter = active[0] ? active[0].id : '';
  const svc = svcOf(state, serviceFilter);
  /* Open on the week that actually has something bookable — on a closed day
     the current week can be entirely in the past. */
  if (week === null) {
    const nx = nextAvailable(state, serviceFilter, null, todayKey());
    week = weekStart(nx ? nx.date : todayKey());
  }
  const block = svc.durationMin + svc.bufferMin;
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const slots = gridSlots(state);
  const today = todayKey();
  const nowMin = deskNowMin(state.settings);
  const pool = staffFilter === 'all' ? state.staff.filter((s) => s.active) : state.staff.filter((s) => s.id === staffFilter);

  const wrap = h('div', {});

  /* ---- head ---- */
  const label = h('span', { class: 'datenav__label' }, `${dayLabel(days[0])} — ${dayLabel(days[6])}`);
  const goto = (delta) => { week = addDays(week, delta * 7); ctx.refresh(); };
  const navBtn = (name, aria, fn) => {
    const b = h('button', { class: 'btn btn--icon', 'aria-label': aria, html: icon(name) });
    if (name === 'arrowRight' && aria === t('calendar.prev')) b.style.transform = 'rotate(180deg)';
    b.addEventListener('click', fn);
    return b;
  };

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, t('calendar.title')),
      h('p', {}, t('calendar.lede', { block }))),
    h('div', { class: 'datenav' },
      navBtn('arrowRight', t('calendar.prev'), () => goto(-1)),
      label,
      navBtn('arrowRight', t('calendar.next'), () => goto(1)),
      (() => {
        const b = h('button', { class: 'btn' }, t('calendar.thisWeek'));
        b.addEventListener('click', () => { week = weekStart(todayKey()); ctx.refresh(); });
        return b;
      })())));

  /* ---- toolbar ---- */
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': t('calendar.staffFilter') });
  [{ id: 'all', name: t('calendar.allStaff') }, ...state.staff.map((s) => ({ id: s.id, name: s.name.split(' ')[0] }))]
    .forEach((o) => {
      const b = h('button', { type: 'button', class: staffFilter === o.id ? 'is-on' : '', 'aria-pressed': String(staffFilter === o.id) }, o.name);
      b.addEventListener('click', () => { staffFilter = o.id; ctx.refresh(); });
      seg.appendChild(b);
    });

  const svcSel = h('select', { class: 'select', style: 'max-width:280px', 'aria-label': t('calendar.serviceToBook') },
    active.map((s) => h('option', { value: s.id, selected: s.id === serviceFilter }, t('calendar.serviceOption', { name: svcName(s), block: s.durationMin + s.bufferMin }))));
  svcSel.addEventListener('change', () => { serviceFilter = svcSel.value; ctx.refresh(); });

  wrap.appendChild(h('div', { class: 'toolbar' },
    seg, svcSel,
    h('div', { class: 'spacer' }),
    h('div', { class: 'legend' },
      h('span', {}, h('b', { class: 'is-free' }), t('calendar.legendFree')),
      h('span', {}, h('b', { class: 'is-full' }), t('calendar.legendFull')),
      h('span', {}, h('b', { class: 'is-today' }), t('calendar.legendToday')))));

  /* ---- week stats ---- */
  const weekBookings = state.bookings.filter((b) => b.date >= days[0] && b.date <= days[6] && b.status !== 'cancelled');
  const utilAvg = Math.round(days.reduce((n, d) => n + utilisation(state, d).pct, 0) / 7);
  let openCount = 0;
  for (const d of days) {
    if (!isOpenDay(state, d)) continue;
    for (const slot of slots) {
      const ids = freeStaffAt(state, d, slot, serviceFilter).filter((id) => pool.some((p) => p.id === id));
      openCount += ids.length;
    }
  }
  wrap.appendChild(h('div', { class: 'grid g3', style: 'margin-bottom:16px' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('calendar.bookedWeek')),
      h('div', { class: 'stat__value' }, String(weekBookings.length)),
      h('div', { class: 'stat__delta' }, t('calendar.stillAhead', { n: weekBookings.filter((b) => b.date >= today).length }))),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('calendar.openSlots', { code: svc.code })),
      h('div', { class: 'stat__value' }, String(openCount)),
      h('div', { class: 'stat__delta' }, staffFilter === 'all' ? t('calendar.acrossAll') : t('calendar.forStaff', { name: staffOf(state, staffFilter).name }))),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('calendar.avgChair')),
      h('div', { class: 'stat__value' }, pct(utilAvg)),
      h('div', { class: 'stat__delta' }, t('calendar.avgSub')))));

  /* ---- grid ---- */
  const grid = h('div', { class: 'cal' });
  grid.appendChild(h('div', { class: 'cal__hcell' }, h('div', { class: 'cal__hd' }, t('calendar.timeCol'))));
  days.forEach((d) => {
    const dt = parseDay(d);
    grid.appendChild(h('div', { class: `cal__hcell${d === today ? ' cal__hcell--today' : ''}` },
      h('div', { class: 'cal__hd' }, dow(dt.getDay())),
      h('div', { class: 'cal__hn' }, `${String(dt.getDate()).padStart(2, '0')} ${monthShort(dt)}`)));
  });

  slots.forEach((time) => {
    grid.appendChild(h('div', { class: 'cal__time' }, hm12(time)));
    days.forEach((d) => {
      const start = toMin(time);
      const onShift = pool.some((st) => staffWorks(state, st.id, d)
        && start >= toMin(st.start) && start < toMin(st.end)
        && !(start >= toMin(st.breakStart) && start < toMin(st.breakEnd)));
      const evs = state.bookings.filter((b) => b.date === d && b.status !== 'cancelled'
        && toMin(b.time) >= start && toMin(b.time) < start + slotMin
        && pool.some((p) => p.id === b.staffId));
      const freeIds = freeStaffAt(state, d, time, serviceFilter).filter((id) => pool.some((p) => p.id === id));
      const past = d < today || (d === today && start + slotMin <= nowMin);
      /* time the desk has held back for a staff member — not a booking, but
         the slot is gone all the same, so the grid has to say so */
      const held = pool.filter((st) => staffWorks(state, st.id, d)
        && blocksOn(state, st.id, d).some((x) => toMin(x.start) < start + slotMin && toMin(x.end) > start));

      let cls = 'cal__cell';
      if (!isOpenDay(state, d) || !onShift) cls += ' cal__cell--shut';
      else if (past) cls += ' cal__cell--past';
      else if (!freeIds.length) cls += ' cal__cell--full';

      const cell = h('button', {
        type: 'button',
        class: cls,
        'aria-label': freeIds.length && !past
          ? t('calendar.bookAria', { service: svcName(svc), day: dayLabel(d), time: hm12(time) })
          : t('calendar.fullAria', {
            day: dayLabel(d),
            time: hm12(time),
            n: evs.length,
            held: held.length ? held.map((st) => st.name).join(t('calendar.and')) : '',
          }),
        disabled: !(freeIds.length && !past) ? true : null,
      });

      if (!isOpenDay(state, d)) cell.appendChild(h('span', { class: 'cal__shut' }, t('calendar.closed')));
      else if (!onShift && !evs.length) cell.appendChild(h('span', { class: 'cal__shut' }, t('calendar.offShift')));
      held.forEach((st) => cell.appendChild(h('div', { class: 'cal__ev cal__ev--held' },
        h('b', {}, t('calendar.held', { initials: st.initials })), t('calendar.heldSub'))));

      evs.slice(0, 2).forEach((b) => {
        cell.appendChild(h('div', { class: `cal__ev cal__ev--${b.staffId}${b.status === 'no-show' ? ' cal__ev--off' : ''}` },
          h('b', {}, `${tokenLabel(state, b)} · ${staffOf(state, b.staffId).initials}`),
          `${custOf(state, b.customerId).name.split(' ')[0]} · ${svcOf(state, b.serviceId).code}`));
      });
      if (evs.length > 2) cell.appendChild(h('span', { class: 'cal__shut' }, t('calendar.more', { n: evs.length - 2 })));
      if (freeIds.length && !past) {
        cell.appendChild(h('span', { class: 'cal__free' }, t('calendar.free', { n: freeIds.length })));
        cell.addEventListener('click', () => openBooking(ctx, {
          date: d,
          time,
          serviceId: serviceFilter,
          staffId: staffFilter === 'all' ? undefined : staffFilter,
        }));
      }
      grid.appendChild(cell);
    });
  });

  wrap.appendChild(h('div', { class: 'calwrap' }, h('div', { class: 'calscroll' }, grid)));
  wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:10px' }, t('calendar.hint')));

  return wrap;
}

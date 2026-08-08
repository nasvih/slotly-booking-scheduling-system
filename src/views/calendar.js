/* Calendar — week grid across the staff resources. Click a free slot to book it. */

import { h, icon, pct } from '../../lib/ui.js';
import {
  todayKey, weekStart, addDays, parseDay, dayLabel, hm12, gridSlots, toMin, deskNowMin,
  isOpenDay, freeStaffAt, staffWorks, nextAvailable, svcOf, staffOf, custOf, tokenLabel, utilisation,
  blocksOn, DOW,
} from '../data.js';
import { openBooking } from '../booking.js';

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
    if (name === 'arrowRight' && aria.startsWith('Previous')) b.style.transform = 'rotate(180deg)';
    b.addEventListener('click', fn);
    return b;
  };

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, 'Week calendar'),
      h('p', {}, `Three staff resources on one grid. A slot is bookable when someone with the right skill is free for the whole ${block} minutes.`)),
    h('div', { class: 'datenav' },
      navBtn('arrowRight', 'Previous week', () => goto(-1)),
      label,
      navBtn('arrowRight', 'Next week', () => goto(1)),
      (() => {
        const b = h('button', { class: 'btn' }, 'This week');
        b.addEventListener('click', () => { week = weekStart(todayKey()); ctx.refresh(); });
        return b;
      })())));

  /* ---- toolbar ---- */
  const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Staff filter' });
  [{ id: 'all', name: 'All staff' }, ...state.staff.map((s) => ({ id: s.id, name: s.name.split(' ')[0] }))]
    .forEach((o) => {
      const b = h('button', { type: 'button', class: staffFilter === o.id ? 'is-on' : '', 'aria-pressed': String(staffFilter === o.id) }, o.name);
      b.addEventListener('click', () => { staffFilter = o.id; ctx.refresh(); });
      seg.appendChild(b);
    });

  const svcSel = h('select', { class: 'select', style: 'max-width:280px', 'aria-label': 'Service to book' },
    active.map((s) => h('option', { value: s.id, selected: s.id === serviceFilter }, `${s.name} · ${s.durationMin + s.bufferMin} min block`)));
  svcSel.addEventListener('change', () => { serviceFilter = svcSel.value; ctx.refresh(); });

  wrap.appendChild(h('div', { class: 'toolbar' },
    seg, svcSel,
    h('div', { class: 'spacer' }),
    h('div', { class: 'legend' },
      h('span', {}, h('b', { class: 'is-free' }), 'Free — click to book'),
      h('span', {}, h('b', { class: 'is-full' }), 'Full, closed or off shift'),
      h('span', {}, h('b', { class: 'is-today' }), 'Today'))));

  /* ---- week stats ---- */
  const weekBookings = state.bookings.filter((b) => b.date >= days[0] && b.date <= days[6] && b.status !== 'cancelled');
  const utilAvg = Math.round(days.reduce((n, d) => n + utilisation(state, d).pct, 0) / 7);
  let openCount = 0;
  for (const d of days) {
    if (!isOpenDay(state, d)) continue;
    for (const t of slots) {
      const ids = freeStaffAt(state, d, t, serviceFilter).filter((id) => pool.some((p) => p.id === id));
      openCount += ids.length;
    }
  }
  wrap.appendChild(h('div', { class: 'grid g3', style: 'margin-bottom:16px' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Booked this week'),
      h('div', { class: 'stat__value' }, String(weekBookings.length)),
      h('div', { class: 'stat__delta' }, `${weekBookings.filter((b) => b.date >= today).length} still ahead`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, `Open ${svc.code} slots`),
      h('div', { class: 'stat__value' }, String(openCount)),
      h('div', { class: 'stat__delta' }, staffFilter === 'all' ? 'Across all staff' : `For ${staffOf(state, staffFilter).name}`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Average chair time'),
      h('div', { class: 'stat__value' }, pct(utilAvg)),
      h('div', { class: 'stat__delta' }, 'Booked minutes over shift minutes'))));

  /* ---- grid ---- */
  const grid = h('div', { class: 'cal' });
  grid.appendChild(h('div', { class: 'cal__hcell' }, h('div', { class: 'cal__hd' }, 'Time')));
  days.forEach((d) => {
    const dt = parseDay(d);
    grid.appendChild(h('div', { class: `cal__hcell${d === today ? ' cal__hcell--today' : ''}` },
      h('div', { class: 'cal__hd' }, DOW[dt.getDay()]),
      h('div', { class: 'cal__hn' }, `${String(dt.getDate()).padStart(2, '0')} ${dt.toLocaleDateString('en-GB', { month: 'short' })}`)));
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
          ? `Book ${svc.name} on ${dayLabel(d)} at ${hm12(time)}`
          : `${dayLabel(d)} ${hm12(time)} — ${evs.length} booked${held.length ? `, held back for ${held.map((st) => st.name).join(' and ')}` : ''}, no room`,
        disabled: !(freeIds.length && !past) ? true : null,
      });

      if (!isOpenDay(state, d)) cell.appendChild(h('span', { class: 'cal__shut' }, 'Closed'));
      else if (!onShift && !evs.length) cell.appendChild(h('span', { class: 'cal__shut' }, 'Off'));
      held.forEach((st) => cell.appendChild(h('div', { class: 'cal__ev cal__ev--held' },
        h('b', {}, `Held · ${st.initials}`), 'Kept off the grid')));

      evs.slice(0, 2).forEach((b) => {
        cell.appendChild(h('div', { class: `cal__ev cal__ev--${b.staffId}${b.status === 'no-show' ? ' cal__ev--off' : ''}` },
          h('b', {}, `${tokenLabel(state, b)} · ${staffOf(state, b.staffId).initials}`),
          `${custOf(state, b.customerId).name.split(' ')[0]} · ${svcOf(state, b.serviceId).code}`));
      });
      if (evs.length > 2) cell.appendChild(h('span', { class: 'cal__shut' }, `+${evs.length - 2} more`));
      if (freeIds.length && !past) {
        cell.appendChild(h('span', { class: 'cal__free' }, `+ ${freeIds.length} free`));
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
  wrap.appendChild(h('p', { class: 'hint', style: 'margin-top:10px' },
    'Slots in the past and slots where nobody with the right skill is free are locked. Booking one writes a real record — it shows up in Today and in Bookings straight away.'));

  return wrap;
}

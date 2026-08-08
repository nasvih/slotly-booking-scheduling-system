/* Staff — working hours, days off and which services each person can take. */

import { h, icon, toast, meter, pct } from '../../lib/ui.js';
import {
  todayKey, addDays, weekStart, parseDay, DOW, hm12, toMin, shiftMinutes, staffWorks, utilisation,
  dayLabel, relativeDay,
} from '../data.js';

function card(ctx, st) {
  const s = ctx.state;
  const week = weekStart(todayKey());
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const draft = {
    days: [...st.days],
    start: st.start, end: st.end, breakStart: st.breakStart, breakEnd: st.breakEnd,
    room: st.room, skills: [...st.skills], active: st.active,
  };

  const dayPick = h('div', { class: 'daypicker', role: 'group', 'aria-label': `${st.name} working days` },
    [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = h('button', {
        type: 'button',
        class: draft.days.includes(d) ? 'is-on' : '',
        'aria-pressed': String(draft.days.includes(d)),
        'aria-label': `${DOW[d]} ${draft.days.includes(d) ? 'working' : 'off'}`,
      }, DOW[d]);
      b.addEventListener('click', () => {
        const i = draft.days.indexOf(d);
        if (i >= 0) draft.days.splice(i, 1); else draft.days.push(d);
        b.classList.toggle('is-on');
        b.setAttribute('aria-pressed', String(draft.days.includes(d)));
      });
      return b;
    }));

  const timeIn = (key, label) => {
    const i = h('input', { class: 'input', type: 'time', value: draft[key], step: '900', 'aria-label': `${st.name} ${label}` });
    i.addEventListener('change', () => { draft[key] = i.value || draft[key]; });
    return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), i);
  };

  const roomIn = h('input', { class: 'input', value: draft.room, 'aria-label': `${st.name} room` });
  roomIn.addEventListener('input', () => { draft.room = roomIn.value; });

  const skills = h('div', { class: 'skillist' }, s.services.map((svc) => {
    const cb = h('input', { type: 'checkbox', checked: draft.skills.includes(svc.id), 'aria-label': `${st.name} can take ${svc.name}` });
    cb.addEventListener('change', () => {
      if (cb.checked) draft.skills.push(svc.id);
      else draft.skills = draft.skills.filter((x) => x !== svc.id);
    });
    return h('label', { class: 'skillrow' }, cb,
      h('span', {}, svc.name),
      h('span', { class: 'mono small faint', style: 'margin-left:auto' }, `${svc.durationMin + svc.bufferMin}m`),
      svc.active ? null : h('span', { class: 'pill' }, 'Off'));
  }));

  const activeCb = h('input', { type: 'checkbox', checked: draft.active, 'aria-label': `${st.name} taking bookings` });
  activeCb.addEventListener('change', () => { draft.active = activeCb.checked; });

  const save = h('button', { class: 'btn btn--primary btn--sm' }, 'Save rota');
  save.addEventListener('click', () => {
    if (toMin(draft.end) <= toMin(draft.start)) { toast('Shift end must be after the start', 'bad'); return; }
    if (toMin(draft.breakEnd) < toMin(draft.breakStart)) { toast('Break end must be after the break start', 'bad'); return; }
    const clash = s.bookings.filter((b) => b.staffId === st.id && b.date >= todayKey()
      && (b.status === 'booked' || b.status === 'called')
      && (!draft.days.includes(parseDay(b.date).getDay())
        || toMin(b.time) < toMin(draft.start) || toMin(b.time) + b.blockMin > toMin(draft.end)
        || (toMin(b.time) < toMin(draft.breakEnd) && toMin(b.time) + b.blockMin > toMin(draft.breakStart))));
    ctx.store.update((d) => {
      Object.assign(d.staff.find((x) => x.id === st.id), draft, { days: [...draft.days].sort() });
    });
    toast(clash.length
      ? `Rota saved — ${clash.length} booking${clash.length === 1 ? '' : 's'} now sit outside the shift`
      : 'Rota saved', clash.length ? 'bad' : 'ok');
  });

  const weekBooked = s.bookings.filter((b) => b.staffId === st.id && b.date >= days[0] && b.date <= days[6] && b.status !== 'cancelled');
  const weekCap = days.reduce((n, d) => n + shiftMinutes(s, st.id, d), 0);
  const weekMin = weekBooked.reduce((n, b) => n + b.blockMin, 0);
  const load = weekCap ? Math.round((weekMin / weekCap) * 100) : 0;

  return h('div', { class: 'card staffcard' },
    h('div', { class: 'staffcard__top' },
      h('span', { class: 'avatar avatar--amber' }, st.initials),
      h('div', { style: 'flex:1;min-width:0' },
        h('h3', {}, st.name),
        h('div', { class: 'small muted' }, `${st.role} · ${st.room}`)),
      h('span', { class: `pill ${st.active ? 'pill--ok' : ''}` }, st.active ? 'Taking bookings' : 'Paused')),

    h('div', { class: 'stack' },
      h('div', {},
        h('div', { class: 'between', style: 'margin-bottom:6px' },
          h('span', { class: 'small' }, 'This week'),
          h('span', { class: 'mono small' }, `${weekBooked.length} bookings · ${pct(load)}`)),
        h('div', { class: 'loadbar' }, meter(weekMin, weekCap || 1, load > 90 ? 'bad' : load > 60 ? '' : 'ok'))),

      h('div', {},
        h('div', { class: 'label', style: 'margin-bottom:6px' }, 'Working days'),
        dayPick),

      h('div', { class: 'fieldrow' }, timeIn('start', 'Shift start'), timeIn('end', 'Shift end')),
      h('div', { class: 'fieldrow' }, timeIn('breakStart', 'Break from'), timeIn('breakEnd', 'Break to')),

      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Room'), roomIn),

      h('div', {},
        h('div', { class: 'label', style: 'margin-bottom:8px' }, 'Services this person can take'),
        skills),

      /* Time held back — written by the desk agent, released from here. */
      (() => {
        const held = (s.blocks || []).filter((x) => x.staffId === st.id && x.date >= todayKey())
          .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
        return h('div', {},
          h('div', { class: 'label', style: 'margin-bottom:8px' }, 'Time held back'),
          held.length
            ? h('div', { class: 'heldlist' }, held.map((x) => {
              const drop = h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': `Release ${hm12(x.start)} to ${hm12(x.end)} on ${dayLabel(x.date)} for ${st.name}` }, 'Release');
              drop.addEventListener('click', () => {
                ctx.store.update((d) => { d.blocks = (d.blocks || []).filter((y) => y.id !== x.id); });
                toast('Time released back onto the grid', 'ok');
              });
              return h('div', { class: 'heldrow' },
                h('div', { style: 'min-width:0' },
                  h('div', { class: 'mono small' }, `${relativeDay(x.date)} · ${hm12(x.start)}–${hm12(x.end)}`),
                  h('div', { class: 'small faint truncate' }, x.reason)),
                drop);
            }))
            : h('p', { class: 'hint', style: 'margin:0' }, 'Nothing held back. Ask the assistant to block a morning or an afternoon and it shows up here.'));
      })(),

      h('div', { class: 'between' },
        h('label', { class: 'switch' }, activeCb, h('span', { class: 'switch__track' }), h('span', {}, 'Taking bookings')),
        save)));
}

export default function renderStaff(ctx) {
  const s = ctx.state;
  const today = todayKey();
  const util = utilisation(s, today);
  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, 'Staff and working hours'),
      h('p', {}, 'The calendar only opens a slot when somebody here is on shift, off break, has the skill and is not already booked. Change a rota and the grid changes with it.'))));

  wrap.appendChild(h('div', { class: 'grid g3', style: 'margin-bottom:18px' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'On shift today'),
      h('div', { class: 'stat__value' }, String(s.staff.filter((st) => staffWorks(s, st.id, today)).length)),
      h('div', { class: 'stat__delta' }, `${s.staff.length} people on the rota`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Chair minutes today'),
      h('div', { class: 'stat__value' }, String(util.capacity)),
      h('div', { class: 'stat__delta' }, `${util.used} minutes already booked`)),
    h('div', { class: 'stat stat--accent' },
      h('div', { class: 'stat__label' }, 'Busiest person today'),
      h('div', { class: 'stat__value' }, (() => {
        const top = util.perStaff.slice().sort((a, b) => b.pct - a.pct)[0];
        return top ? `${top.pct}%` : '0%';
      })()),
      h('div', { class: 'stat__delta' }, (() => {
        const top = util.perStaff.slice().sort((a, b) => b.pct - a.pct)[0];
        return top ? top.name : '—';
      })()))));

  wrap.appendChild(h('div', { class: 'staffgrid' }, s.staff.map((st) => card(ctx, st))));

  wrap.appendChild(h('div', { class: 'banner', style: 'margin-top:18px' },
    h('span', { html: icon('alert') }),
    h('div', {}, 'Shift hours are read against the desk opening hours in Settings. A slot outside ',
      h('span', { class: 'mono' }, `${hm12(s.settings.openTime)}–${hm12(s.settings.closeTime)}`),
      ' never shows on the grid, even if a shift covers it.')));

  return wrap;
}

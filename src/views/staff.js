/* Staff — working hours, days off and which services each person can take. */

import { h, icon, toast, meter, pct } from '../../lib/ui.js';
import {
  todayKey, addDays, weekStart, parseDay, dow, hm12, toMin, shiftMinutes, staffWorks, utilisation,
  dayLabel, relativeDay, svcName, staffRole, staffRoom,
} from '../data.js';
import { t } from '../main.js';

function card(ctx, st) {
  const s = ctx.state;
  const week = weekStart(todayKey());
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));

  const draft = {
    days: [...st.days],
    start: st.start, end: st.end, breakStart: st.breakStart, breakEnd: st.breakEnd,
    room: staffRoom(st), skills: [...st.skills], active: st.active,
  };

  const dayPick = h('div', { class: 'daypicker', role: 'group', 'aria-label': t('staff.workingDaysAria', { name: st.name }) },
    [1, 2, 3, 4, 5, 6, 0].map((d) => {
      const b = h('button', {
        type: 'button',
        class: draft.days.includes(d) ? 'is-on' : '',
        'aria-pressed': String(draft.days.includes(d)),
        'aria-label': t('staff.dayAria', { day: dow(d), on: draft.days.includes(d) }),
      }, dow(d));
      b.addEventListener('click', () => {
        const i = draft.days.indexOf(d);
        if (i >= 0) draft.days.splice(i, 1); else draft.days.push(d);
        b.classList.toggle('is-on');
        b.setAttribute('aria-pressed', String(draft.days.includes(d)));
      });
      return b;
    }));

  const timeIn = (key, label) => {
    const i = h('input', { class: 'input', type: 'time', value: draft[key], step: '900', 'aria-label': t('staff.timeAria', { name: st.name, label }) });
    i.addEventListener('change', () => { draft[key] = i.value || draft[key]; });
    return h('label', { class: 'field' }, h('span', { class: 'field__label' }, label), i);
  };

  const roomIn = h('input', { class: 'input', value: draft.room, 'aria-label': t('staff.roomAria', { name: st.name }) });
  roomIn.addEventListener('input', () => { draft.room = roomIn.value; });

  const skills = h('div', { class: 'skillist' }, s.services.map((svc) => {
    const cb = h('input', { type: 'checkbox', checked: draft.skills.includes(svc.id), 'aria-label': t('staff.skillAria', { name: st.name, service: svcName(svc) }) });
    cb.addEventListener('change', () => {
      if (cb.checked) draft.skills.push(svc.id);
      else draft.skills = draft.skills.filter((x) => x !== svc.id);
    });
    return h('label', { class: 'skillrow' }, cb,
      h('span', {}, svcName(svc)),
      h('span', { class: 'mono small faint', style: 'margin-left:auto' }, t('common.minShort', { n: svc.durationMin + svc.bufferMin })),
      svc.active ? null : h('span', { class: 'pill' }, t('common.off')));
  }));

  const activeCb = h('input', { type: 'checkbox', checked: draft.active, 'aria-label': t('staff.activeAria', { name: st.name }) });
  activeCb.addEventListener('change', () => { draft.active = activeCb.checked; });

  const save = h('button', { class: 'btn btn--primary btn--sm' }, t('staff.saveRota'));
  save.addEventListener('click', () => {
    if (toMin(draft.end) <= toMin(draft.start)) { toast(t('staff.endAfterStart'), 'bad'); return; }
    if (toMin(draft.breakEnd) < toMin(draft.breakStart)) { toast(t('staff.breakEndAfterStart'), 'bad'); return; }
    const clash = s.bookings.filter((b) => b.staffId === st.id && b.date >= todayKey()
      && (b.status === 'booked' || b.status === 'called')
      && (!draft.days.includes(parseDay(b.date).getDay())
        || toMin(b.time) < toMin(draft.start) || toMin(b.time) + b.blockMin > toMin(draft.end)
        || (toMin(b.time) < toMin(draft.breakEnd) && toMin(b.time) + b.blockMin > toMin(draft.breakStart))));
    ctx.store.update((d) => {
      Object.assign(d.staff.find((x) => x.id === st.id), draft, { days: [...draft.days].sort() });
    });
    toast(clash.length
      ? t('staff.rotaClash', { n: clash.length })
      : t('staff.rotaSaved'), clash.length ? 'bad' : 'ok');
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
        h('div', { class: 'small muted' }, `${staffRole(st)} · ${staffRoom(st)}`)),
      h('span', { class: `pill ${st.active ? 'pill--ok' : ''}` }, st.active ? t('staff.takingBookings') : t('staff.paused'))),

    h('div', { class: 'stack' },
      h('div', {},
        h('div', { class: 'between', style: 'margin-bottom:6px' },
          h('span', { class: 'small' }, t('staff.thisWeek')),
          h('span', { class: 'mono small' }, t('staff.weekLine', { n: weekBooked.length, pct: pct(load) }))),
        h('div', { class: 'loadbar' }, meter(weekMin, weekCap || 1, load > 90 ? 'bad' : load > 60 ? '' : 'ok'))),

      h('div', {},
        h('div', { class: 'label', style: 'margin-bottom:6px' }, t('staff.workingDays')),
        dayPick),

      h('div', { class: 'fieldrow' }, timeIn('start', t('staff.shiftStart')), timeIn('end', t('staff.shiftEnd'))),
      h('div', { class: 'fieldrow' }, timeIn('breakStart', t('staff.breakFrom')), timeIn('breakEnd', t('staff.breakTo'))),

      h('label', { class: 'field' }, h('span', { class: 'field__label' }, t('staff.room')), roomIn),

      h('div', {},
        h('div', { class: 'label', style: 'margin-bottom:8px' }, t('staff.skills')),
        skills),

      /* Time held back — written by the desk agent, released from here. */
      (() => {
        const held = (s.blocks || []).filter((x) => x.staffId === st.id && x.date >= todayKey())
          .sort((a, b) => (a.date === b.date ? a.start.localeCompare(b.start) : a.date.localeCompare(b.date)));
        return h('div', {},
          h('div', { class: 'label', style: 'margin-bottom:8px' }, t('staff.heldBack')),
          held.length
            ? h('div', { class: 'heldlist' }, held.map((x) => {
              const drop = h('button', { class: 'btn btn--sm', type: 'button', 'aria-label': t('staff.releaseAria', { from: hm12(x.start), to: hm12(x.end), day: dayLabel(x.date), name: st.name }) }, t('staff.release'));
              drop.addEventListener('click', () => {
                ctx.store.update((d) => { d.blocks = (d.blocks || []).filter((y) => y.id !== x.id); });
                toast(t('staff.released'), 'ok');
              });
              return h('div', { class: 'heldrow' },
                h('div', { style: 'min-width:0' },
                  h('div', { class: 'mono small' }, `${relativeDay(x.date)} · ${hm12(x.start)}–${hm12(x.end)}`),
                  h('div', { class: 'small faint truncate' }, x.reason)),
                drop);
            }))
            : h('p', { class: 'hint', style: 'margin:0' }, t('staff.nothingHeld')));
      })(),

      h('div', { class: 'between' },
        h('label', { class: 'switch' }, activeCb, h('span', { class: 'switch__track' }), h('span', {}, t('staff.takingBookings'))),
        save)));
}

export default function renderStaff(ctx) {
  const s = ctx.state;
  const today = todayKey();
  const util = utilisation(s, today);
  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, t('staff.title')),
      h('p', {}, t('staff.lede')))));

  wrap.appendChild(h('div', { class: 'grid g3', style: 'margin-bottom:18px' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('staff.onShift')),
      h('div', { class: 'stat__value' }, String(s.staff.filter((st) => staffWorks(s, st.id, today)).length)),
      h('div', { class: 'stat__delta' }, t('staff.onRota', { n: s.staff.length }))),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, t('staff.chairMinutes')),
      h('div', { class: 'stat__value' }, String(util.capacity)),
      h('div', { class: 'stat__delta' }, t('staff.alreadyBooked', { n: util.used }))),
    h('div', { class: 'stat stat--accent' },
      h('div', { class: 'stat__label' }, t('staff.busiest')),
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
    h('div', {}, t('staff.bannerA'),
      h('span', { class: 'mono' }, `${hm12(s.settings.openTime)}–${hm12(s.settings.closeTime)}`),
      t('staff.bannerB'))));

  return wrap;
}

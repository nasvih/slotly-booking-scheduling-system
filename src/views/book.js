/* ============================================================
   slotly — the booking page. The front door.

   This is the screen a customer lands on: one calm column, five plain
   questions, no sidebar and none of the desk's vocabulary. It is not a
   second booking engine. Every rule about who is free and when comes
   from src/data.js — the same freeSlots / freeStaffAt / createBooking
   the staff dialog uses — so a booking made here lands in the same
   store, blocks the slot on the calendar and shows up in the Today
   queue the moment it is confirmed.
   ============================================================ */

import { h, icon, money } from '../../lib/ui.js';
import {
  todayKey, addDays, dayLabel, relativeDay, hm12, toMin, dow, dowLong,
  parseDay, deskNowMin, isOpenDay, staffWorks, freeSlots, freeStaffAt,
  createBooking, svcOf, staffOf, tokenLabel, svcName, staffRole, staffRoom, deskName, branchName,
} from '../data.js';
import { openToken } from '../token.js';
import { t } from '../main.js';

const ANY = '__any';

/* The page's live region lives in the shell, not in this view: a redraw
   replaces everything below the bar, and a region replaced by the very update
   it should announce announces nothing. src/main.js owns the node. */
function announce(msg) {
  const el = document.getElementById('pub-live');
  if (!el) return;
  el.textContent = '';
  setTimeout(() => { el.textContent = msg; }, 60);
}

/* Two weeks is as far ahead as the desk publishes. Enough to find a slot,
   short enough that the strip is a handful of taps rather than a calendar. */
const HORIZON = 14;

/* Module-level, like every other view's filter state: a store write re-runs
   render() from the top, and a half-filled form must survive that. */
let draft = null;
/* Set inside the store write that creates the booking, so the redraw that
   write triggers already knows to print the confirmation. */
let confirmedId = null;

function blankDraft(state) {
  const first = state.services.find((s) => s.active);
  return {
    serviceId: first ? first.id : null,
    date: todayKey(),
    time: '',
    staffId: ANY,
    name: '',
    phone: '',
    note: '',
  };
}

/* ---------- the phone number ----------
   A demo, but a wrong number is the one field that would actually cost the
   desk something, so it is checked rather than trusted. Indian mobile
   numbers: ten digits, optionally written with +91, a leading 0, spaces or
   dashes. */
const digitsOf = (s) => String(s || '').replace(/\D/g, '');
function phoneDigits(raw) {
  let d = digitsOf(raw);
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}
const phoneOk = (raw) => /^[6-9]\d{9}$/.test(phoneDigits(raw));

/* Stored the way every other number in this demo is stored — masked, with
   only the last four digits kept. Nothing here is a real person. */
const maskPhone = (raw) => `+91 ••••• ${phoneDigits(raw).slice(-4)}`;

/** An existing customer with the same name and the same last four digits is
    the same person coming back; anything else is somebody new. */
function findCustomer(state, name, raw) {
  const tail = phoneDigits(raw).slice(-4);
  const key = name.trim().toLowerCase();
  return state.customers.find((c) => c.name.trim().toLowerCase() === key
    && digitsOf(c.phone).slice(-4) === tail) || null;
}

/* ---------- availability, read straight from the desk's own rules ---------- */
const cutoffFor = (state, date) => (date === todayKey() ? deskNowMin(state.settings) : -1);

function openSlots(state, date, serviceId, staffId) {
  const cutoff = cutoffFor(state, date);
  return freeSlots(state, date, serviceId, staffId === ANY ? null : staffId)
    .filter((s) => toMin(s.time) > cutoff);
}

/** The next fourteen days with the number of free slots on each. */
function dayStrip(state, serviceId) {
  const start = todayKey();
  const out = [];
  for (let i = 0; i < HORIZON; i += 1) {
    const key = addDays(start, i);
    const open = isOpenDay(state, key);
    out.push({ key, open, free: open ? openSlots(state, key, serviceId, ANY).length : 0 });
  }
  return out;
}

/** Nobody rostered is a different sentence from everything taken. */
function anyoneOnDuty(state, date, serviceId) {
  return state.staff.some((st) => st.active && st.skills.includes(serviceId)
    && staffWorks(state, st.id, date));
}

/* ---------- the page ---------- */
export default function render(ctx) {
  const state = ctx.state;
  if (!draft) draft = blankDraft(state);

  const wrap = h('div', { class: 'pub' });

  /* --- confirmation --- */
  const done = confirmedId && state.bookings.find((b) => b.id === confirmedId);
  if (done) {
    wrap.appendChild(confirmation(ctx, done));
    return wrap;
  }

  const active = state.services.filter((s) => s.active);
  if (!active.length) {
    wrap.appendChild(h('div', { class: 'pub__col' },
      h('div', { class: 'empty' },
        h('h3', {}, t('book.offHead')),
        h('p', { class: 'small muted' }, t('book.offBody')))));
    return wrap;
  }
  if (!active.some((s) => s.id === draft.serviceId)) draft.serviceId = active[0].id;

  const col = h('div', { class: 'pub__col' });
  wrap.appendChild(col);

  col.appendChild(h('div', { class: 'pub__intro' },
    h('h1', {}, t('book.h1')),
    h('p', { class: 'pub__lede' }, t('book.lede', { desk: deskName(state) }))));

  /* What went wrong, in words, right above the button that refused. The same
     sentence also goes to the page's permanent live region — see announce(). */
  const live = h('p', { class: 'pub__live' });
  const say = (msg, bad = false) => {
    live.textContent = msg || '';
    live.classList.toggle('is-bad', !!msg && bad);
    live.classList.toggle('is-on', !!msg);
    if (msg) announce(msg);
  };

  const dayHost = h('div', {});
  const timeHost = h('div', {});
  const whoHost = h('div', {});
  const summaryEl = h('p', { class: 'pub__sum' });

  /* --- 1. service --- */
  const svcHost = h('div', { class: 'pub__opts', role: 'radiogroup', 'aria-label': t('book.serviceAria') });
  const drawServices = () => {
    svcHost.innerHTML = '';
    active.forEach((s) => {
      const on = s.id === draft.serviceId;
      const b = h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(on),
        class: `pubopt${on ? ' is-on' : ''}`,
      },
      h('span', { class: 'pubopt__main' },
        h('span', { class: 'pubopt__name' }, svcName(s)),
        h('span', { class: 'pubopt__meta' }, t('book.minutes', { n: s.durationMin }))),
      h('span', { class: 'pubopt__price mono' }, money(s.priceInr, state.settings.currency)));
      b.addEventListener('click', () => {
        if (draft.serviceId === s.id) return;
        draft.serviceId = s.id;
        draft.time = '';
        draft.staffId = ANY;
        say('');
        drawServices();
        drawDays();
        drawTimes();
      });
      svcHost.appendChild(b);
    });
  };

  /* --- 2. day --- */
  const drawDays = () => {
    dayHost.innerHTML = '';
    const days = dayStrip(state, draft.serviceId);
    const today = days[0];
    if (!today.open) {
      const next = days.find((d) => d.open);
      dayHost.appendChild(h('p', { class: 'pub__notice' },
        t('book.closedToday', { day: dowLong(parseDay(today.key).getDay()) }),
        next ? t('book.nextOpen', { day: dayLabel(next.key) }) : ''));
    } else if (!today.free) {
      const next = days.find((d) => d.free);
      dayHost.appendChild(h('p', { class: 'pub__notice' },
        t('book.fullToday'),
        next ? t('book.firstFree', { day: dayLabel(next.key) }) : ''));
    }

    const grid = h('div', { class: 'pub__days', role: 'radiogroup', 'aria-label': t('book.dayAria') });
    days.forEach((d) => {
      const dt = parseDay(d.key);
      const on = d.key === draft.date;
      const usable = d.open && d.free > 0;
      const b = h('button', {
        type: 'button',
        role: 'radio',
        'aria-checked': String(on),
        class: `pubday${on ? ' is-on' : ''}${usable ? '' : ' is-off'}`,
        disabled: usable ? null : true,
        'aria-label': t('book.dayAriaFull', {
          day: dayLabel(d.key),
          state: usable ? t('book.dayFree', { n: d.free }) : d.open ? t('book.dayFull') : t('book.dayClosed'),
        }),
      },
      h('span', { class: 'pubday__dow' }, dow(dt.getDay())),
      h('span', { class: 'pubday__n' }, String(dt.getDate())),
      h('span', { class: 'pubday__free' }, d.open ? (d.free ? t('book.free', { n: d.free }) : t('book.full')) : t('book.closed')));
      b.addEventListener('click', () => {
        draft.date = d.key;
        draft.time = '';
        draft.staffId = ANY;
        say('');
        drawDays();
        drawTimes();
      });
      grid.appendChild(b);
    });
    dayHost.appendChild(grid);
  };

  /* --- 3. time, and 4. who --- */
  const drawTimes = () => {
    timeHost.innerHTML = '';
    const slots = openSlots(state, draft.date, draft.serviceId, ANY);
    /* Any write to the store redraws this page, so this runs the moment the
       desk takes the slot somebody is part-way through choosing. Holding a
       time that no longer exists is how a form ends up booking a different
       day, so it is dropped here and said out loud. */
    if (draft.time && !slots.some((s) => s.time === draft.time)) {
      const lost = draft.time;
      draft.time = '';
      draft.staffId = ANY;
      say(t('book.lostSlot', { time: hm12(lost) }), true);
    }
    if (!slots.length) {
      timeHost.appendChild(emptyDay(state, draft, (key) => {
        draft.date = key;
        draft.time = '';
        say('');
        drawDays();
        drawTimes();
      }));
      drawWho();
      updateSummary();
      return;
    }
    const grid = h('div', { class: 'pub__times', role: 'radiogroup', 'aria-label': t('book.timeAria') });
    slots.forEach((s) => {
      const on = s.time === draft.time;
      const b = h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(on),
        class: `pubtime${on ? ' is-on' : ''}`,
      }, hm12(s.time));
      b.addEventListener('click', () => {
        draft.time = s.time;
        draft.staffId = ANY;
        say('');
        drawTimes();
        drawWho();
        updateSummary();
      });
      grid.appendChild(b);
    });
    timeHost.appendChild(grid);
    drawWho();
    updateSummary();
  };

  /* Asked after the time rather than before it: whoever is free at that
     moment is a short, true list, where "who do you want" asked first would
     quietly empty the time grid and leave nothing to explain it. */
  const drawWho = () => {
    whoHost.innerHTML = '';
    if (!draft.time) return;
    const ids = freeStaffAt(state, draft.date, draft.time, draft.serviceId);
    if (ids.length < 2) return;
    whoHost.appendChild(h('h2', { class: 'pub__q' }, t('book.qWho'),
      h('span', { class: 'pub__opt' }, t('book.optional'))));
    const row = h('div', { class: 'pub__who', role: 'radiogroup', 'aria-label': t('book.whoAria') });
    [{ id: ANY, name: t('book.whoever'), role: '' },
      ...ids.map((id) => staffOf(state, id))].forEach((p) => {
      const on = (p.id || ANY) === draft.staffId;
      const b = h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(on),
        class: `pubwho${on ? ' is-on' : ''}`,
      },
      h('span', { class: 'pubwho__n' }, p.name),
      p.role ? h('span', { class: 'pubwho__r' }, staffRole(p)) : null);
      b.addEventListener('click', () => {
        draft.staffId = p.id || ANY;
        drawWho();
        updateSummary();
      });
      row.appendChild(b);
    });
    whoHost.appendChild(row);
  };

  const updateSummary = () => {
    const svc = svcOf(state, draft.serviceId);
    if (!draft.time) { summaryEl.textContent = t('book.pickTime'); return; }
    const ids = freeStaffAt(state, draft.date, draft.time, draft.serviceId)
      .filter((id) => draft.staffId === ANY || id === draft.staffId);
    const who = ids.length ? staffOf(state, ids[0]).name : t('book.nextPersonFree');
    summaryEl.textContent = t('book.summary', {
      service: svcName(svc),
      day: relativeDay(draft.date),
      time: hm12(draft.time),
      duration: svc.durationMin,
      who,
      price: money(svc.priceInr, state.settings.currency),
    });
  };

  /* --- 5. details --- */
  const nameIn = h('input', {
    class: 'input', type: 'text', id: 'pub-name', name: 'name',
    autocomplete: 'name', placeholder: t('book.namePlaceholder'), value: draft.name,
  });
  const phoneIn = h('input', {
    class: 'input', type: 'tel', id: 'pub-phone', name: 'phone',
    autocomplete: 'tel', inputmode: 'tel', placeholder: t('book.mobilePlaceholder'), value: draft.phone,
  });
  const noteIn = h('input', {
    class: 'input', type: 'text', id: 'pub-note', name: 'note',
    placeholder: t('book.notePlaceholder'), value: draft.note,
  });
  nameIn.addEventListener('input', () => { draft.name = nameIn.value; });
  phoneIn.addEventListener('input', () => { draft.phone = phoneIn.value; });
  noteIn.addEventListener('input', () => { draft.note = noteIn.value; });

  const confirmBtn = h('button', { class: 'btn btn--primary pub__go', type: 'submit' }, t('book.confirm'));

  const form = h('form', { class: 'pub__form', novalidate: true },
    h('div', { class: 'pub__fields' },
      h('div', { class: 'field' },
        h('label', { class: 'field__label', for: 'pub-name' }, t('book.yourName')), nameIn),
      h('div', { class: 'field' },
        h('label', { class: 'field__label', for: 'pub-phone' }, t('book.mobile')), phoneIn,
        h('p', { class: 'hint' }, t('book.mobileHint'))),
      h('div', { class: 'field' },
        h('label', { class: 'field__label', for: 'pub-note' }, t('book.noteLabel')), noteIn)),
    summaryEl,
    live,
    confirmBtn);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!draft.time) {
      say(t('book.errTime'), true);
      return;
    }
    if (draft.name.trim().length < 2) {
      say(t('book.errName'), true);
      nameIn.focus();
      return;
    }
    if (!phoneOk(draft.phone)) {
      say(t('book.errPhone'), true);
      phoneIn.focus();
      return;
    }
    /* Last check against the live store: somebody at the desk may have taken
       this slot while the form sat open. */
    const ids = freeStaffAt(ctx.state, draft.date, draft.time, draft.serviceId)
      .filter((id) => draft.staffId === ANY || id === draft.staffId);
    if (!ids.length) {
      const taken = draft.time;
      draft.time = '';
      draft.staffId = ANY;
      drawDays();
      drawTimes();
      say(t('book.errTaken', { time: hm12(taken) }), true);
      return;
    }

    const name = draft.name.trim();
    const phone = draft.phone;
    ctx.store.update((s) => {
      let cust = findCustomer(s, name, phone);
      if (!cust) {
        cust = {
          id: `cus-${Math.random().toString(36).slice(2, 8)}`,
          name,
          phone: maskPhone(phone),
          email: '',
          since: todayKey(),
          tags: [],
          note: '',
        };
        s.customers.push(cust);
      }
      const made = createBooking(s, {
        date: draft.date,
        time: draft.time,
        serviceId: draft.serviceId,
        staffId: ids[0],
        customerId: cust.id,
        channel: 'Website',
        note: draft.note.trim(),
      });
      made.history = [{ at: Date.now(), key: 'bookedOnline' }];
      /* Set before the store notifies its subscribers, so the redraw that
         write causes paints the confirmation rather than the empty form. */
      confirmedId = made.id;
    });
    const fresh = ctx.state.bookings.find((b) => b.id === confirmedId);
    if (fresh) openToken(ctx, fresh, { title: t('dialog.bookedTitle') });
  });

  /* --- assemble --- */
  col.appendChild(h('h2', { class: 'pub__q' }, t('book.qService')));
  col.appendChild(svcHost);
  col.appendChild(h('h2', { class: 'pub__q' }, t('book.qDay')));
  col.appendChild(dayHost);
  col.appendChild(h('h2', { class: 'pub__q' }, t('book.qTime')));
  col.appendChild(timeHost);
  col.appendChild(whoHost);
  col.appendChild(h('h2', { class: 'pub__q' }, t('book.qDetails')));
  col.appendChild(form);

  drawServices();
  /* Land on the first day that can actually be booked, so the common case is
     one tap rather than a hunt through a fortnight of full days. Once only:
     every store write redraws this page, and a day that quietly moved under
     a half-filled form would be a booking on a date nobody chose. */
  if (!draft.landed) {
    draft.landed = true;
    if (!openSlots(state, draft.date, draft.serviceId, ANY).length) {
      const firstFree = dayStrip(state, draft.serviceId).find((d) => d.free);
      if (firstFree) draft.date = firstFree.key;
    }
  }
  drawDays();
  drawTimes();

  return wrap;
}

/** Why a chosen day has nothing on it, said in the words that are true. */
function emptyDay(state, d, onJump) {
  const svc = svcOf(state, d.serviceId);
  let head = t('book.emptyNothing');
  let body = t('book.emptyNothingBody', { service: svcName(svc), day: dayLabel(d.date) });
  if (!isOpenDay(state, d.date)) {
    head = t('book.emptyClosed');
    body = t('book.emptyClosedBody', { desk: deskName(state), day: dowLong(parseDay(d.date).getDay()) });
  } else if (!anyoneOnDuty(state, d.date, d.serviceId)) {
    head = t('book.emptyNobody');
    body = t('book.emptyNobodyBody', { service: svcName(svc), day: dayLabel(d.date) });
  } else if (d.date === todayKey()) {
    body = t('book.emptyTodayBody', { service: svcName(svc) });
  }

  const box = h('div', { class: 'empty pub__empty' },
    h('h3', {}, head),
    h('p', { class: 'small muted' }, body));

  /* Never a dead end: if there is a free slot anywhere in the fortnight, the
     page offers it as one button. */
  const next = dayStrip(state, d.serviceId).find((x) => x.free);
  if (next) {
    const first = openSlots(state, next.key, d.serviceId, ANY)[0];
    const b = h('button', { class: 'btn', type: 'button' },
      t('book.goTo', { day: relativeDay(next.key), from: first ? hm12(first.time) : '' }));
    b.addEventListener('click', () => onJump(next.key));
    box.appendChild(h('div', { class: 'pub__emptyact' }, b));
  }
  return box;
}

/* ---------- after the booking ---------- */
function confirmation(ctx, b) {
  const state = ctx.state;
  const svc = svcOf(state, b.serviceId);
  const st = staffOf(state, b.staffId);
  const col = h('div', { class: 'pub__col' });

  const rows = [
    [t('book.rows.what'), svcName(svc)],
    [t('book.rows.when'), t('book.whenLine', { rel: relativeDay(b.date), day: dayLabel(b.date), time: hm12(b.time) })],
    [t('book.rows.with'), `${st.name}${staffRoom(st) ? ` · ${staffRoom(st)}` : ''}`],
    [t('book.rows.where'), t('book.whereLine', { desk: deskName(state), branch: branchName(state) })],
    [t('book.rows.pay'), money(svc.priceInr, state.settings.currency)],
  ];

  announce(t('book.announce', {
    token: tokenLabel(state, b), ref: b.ref, service: svcName(svc),
    day: dayLabel(b.date), time: hm12(b.time), staff: st.name,
  }));

  const card = h('div', { class: 'pubdone' },
    h('div', { class: 'pubdone__tick', 'aria-hidden': 'true', html: icon('check') }),
    h('h1', { class: 'pubdone__h' }, t('book.doneH')),
    h('p', { class: 'pubdone__sub' }, t('book.doneSub', { token: tokenLabel(state, b) })),
    h('div', { class: 'pubdone__tok' },
      h('div', { class: 'pubdone__toklabel' }, t('book.yourToken')),
      h('div', { class: 'pubdone__tokn mono' }, tokenLabel(state, b)),
      h('div', { class: 'pubdone__ref mono' }, b.ref)),
    h('dl', { class: 'pubdone__kv' }, rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])));

  const slipBtn = h('button', { class: 'btn btn--primary', type: 'button' }, t('book.showToken'));
  slipBtn.addEventListener('click', () => openToken(ctx, b, { title: t('dialog.bookedTitle') }));
  const againBtn = h('button', { class: 'btn', type: 'button' }, t('book.bookAnother'));
  againBtn.addEventListener('click', () => {
    confirmedId = null;
    draft = blankDraft(ctx.state);
    ctx.refresh();
  });
  card.appendChild(h('div', { class: 'pubdone__acts' }, slipBtn, againBtn));

  col.appendChild(card);
  return col;
}

/** Reset the page when it is left, so a returning visitor starts clean. */
export function resetBookingPage() {
  draft = null;
  confirmedId = null;
}

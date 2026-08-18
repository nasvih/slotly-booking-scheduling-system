/* ============================================================
   slotly — the things the desk agent can actually do.
   Each intent here reads a plain sentence, works out exactly which
   record it names, and proposes a single concrete change. Nothing is
   written until the reader presses the button on the answer: the
   proposal shows what was understood, the result reports before and
   after, and the store update makes it appear on Today, the calendar
   and the bookings table immediately.
   ============================================================ */

import {
  todayKey, addDays, dayLabel, relativeDay, hm12, toMin, toHM, deskNowMin, parseDay,
  freeSlots, freeStaffAt, nextAvailable, isOpenDay, staffWorks, blocksOn,
  svcOf, staffOf, custOf, tokenLabel, createBooking, assignTokens, logEvent,
  addBlock, gridSlots, STATUS, dowLong, OPEN_STATUSES, svcName, staffRole,
} from './data.js';
import {
  matchDay, matchService, matchStaff, withStaff, matchCustomer, matchTime,
  snapToGrid, matchBooking, matchWindow, matchNumber, bookingCustomer,
} from './parse.js';
import { openToken } from './token.js';
import { t } from './main.js';

/* ---------- shared shapes ---------- */
const ask = (text, suggestions) => ({ text, suggestions: suggestions || actionChips(), meta: t('act.nothingChanged') });
const understood = (rows) => ({ head: t('act.understood'), rows });

/**
 * The panel awaits whatever run() returns, so the result object must not carry
 * a `then` — a plain object with a then function is a thenable and would hang
 * the await forever. Anything that should happen after the reply lands is
 * queued instead.
 */
const andThen = (fn) => { setTimeout(fn, 160); };

/* Read on demand: `t` comes from main.js, whose body has not run while this
   module is being evaluated, so the chips cannot be a module-level const. */
export const actionChips = () => t('act.chips');

/** The slot closest to the one asked for, on that day if possible. */
function nearestFree(state, key, serviceId, staffId, wantHM, ignoreId) {
  const cutoff = key === todayKey() ? deskNowMin(state.settings) : -1;
  const slots = freeSlots(state, key, serviceId, staffId, ignoreId).filter((s) => toMin(s.time) > cutoff);
  if (slots.length) {
    const want = toMin(wantHM || '00:00');
    const best = slots.slice().sort((a, b) => Math.abs(toMin(a.time) - want) - Math.abs(toMin(b.time) - want))[0];
    return { date: key, time: best.time, staffIds: best.staffIds, sameDay: true };
  }
  const nx = nextAvailable(state, serviceId, staffId, key);
  return nx ? { date: nx.date, time: nx.time, staffIds: nx.staffIds, sameDay: false } : null;
}

const openCount = (state, key, serviceId, staffId) => freeSlots(state, key, serviceId, staffId).length;

const svcBlock = (svc) => svc.durationMin + svc.bufferMin;

/* Roll a closed day forward so a proposal always lands on a day the desk works. */
function openDayFrom(state, key) {
  let roll = key;
  for (let i = 0; i < 8 && !isOpenDay(state, roll); i += 1) roll = addDays(key, i + 1);
  return roll;
}

/* ============================================================
   1. Book an appointment from a sentence
   ============================================================ */
function proposeBook(ctx, q) {
  const state = ctx.state;
  const active = state.services.filter((s) => s.active);
  if (!active.length) return ask(t('act.book.allOff'));

  const who = bookingCustomer(state, q);
  const serviceId = matchService(state, q);
  if (!serviceId) {
    return ask(t('act.book.whichService', { list: active.map((s) => svcName(s)).join(', ') }));
  }
  const svc = svcOf(state, serviceId);
  if (!svc.active) return ask(t('act.book.serviceOff', { service: svcName(svc) }));
  if (!who.phrase) {
    return ask(t('act.book.whoFor', { service: svcName(svc), lower: svcName(svc).toLowerCase() }));
  }

  /* A day that has gone, or a day the desk does not open, is corrected forward
     rather than refused outright — the reply says so before anything is held. */
  const asked = matchDay(q) || todayKey();
  const past = asked < todayKey();
  const day = openDayFrom(state, past ? todayKey() : asked);
  const rollNote = past
    ? t('act.book.rolledPast', { day: dayLabel(asked), to: relativeDay(day) })
    : day !== asked
      ? t('act.book.rolledClosed', { day: dowLong(parseDay(asked).getDay()), to: relativeDay(day) })
      : '';
  const staffId = withStaff(state, q);
  if (staffId && !staffOf(state, staffId).skills.includes(serviceId)) {
    const other = state.staff.filter((s) => s.active && s.skills.includes(serviceId)).map((s) => s.name);
    return ask(t('act.book.wrongSkill', {
      staff: staffOf(state, staffId).name,
      service: svcName(svc),
      others: other.join(t('calendar.and')) || t('act.book.nobodyOnRota'),
    }));
  }
  if (staffId && !staffWorks(state, staffId, day)) {
    return ask(t('act.book.notOnRota', {
      staff: staffOf(state, staffId).name,
      day: dayLabel(day),
      days: staffOf(state, staffId).days.map((d) => dowLong(d).slice(0, 3)).join(', '),
    }));
  }

  const wanted = matchTime(state, q);
  let time = wanted ? snapToGrid(state, wanted) : null;
  const snapped = !!(wanted && time && time !== wanted);
  let ids = time ? freeStaffAt(state, day, time, serviceId).filter((id) => !staffId || id === staffId) : [];
  const cutoff = day === todayKey() ? deskNowMin(state.settings) : -1;
  if (time && toMin(time) <= cutoff) ids = [];

  /* No time asked for: propose the first opening rather than guessing. */
  if (!time) {
    const near = nearestFree(state, day, serviceId, staffId, '10:00');
    if (!near) {
      return ask(t('act.book.nothingInThree', {
        service: svcName(svc),
        staff: staffId ? staffOf(state, staffId).name : '',
        who: who.phrase,
      }));
    }
    time = near.time;
    ids = near.staffIds;
    return buildBookProposal(ctx, {
      who, serviceId, staffId, day: near.date, time, ids, q,
      lead: t('act.book.firstOpening', { roll: rollNote, day: relativeDay(near.date), time: hm12(time) }),
    });
  }

  /* Asked for a slot that is gone: refuse, and offer the nearest one instead. */
  if (!ids.length) {
    const near = nearestFree(state, day, serviceId, staffId, time);
    /* only somebody who could have taken this service counts as holding the
       slot — otherwise the refusal names an unrelated appointment */
    const able = state.staff.filter((s) => s.active && s.skills.includes(serviceId) && (!staffId || s.id === staffId)).map((s) => s.id);
    const holder = state.bookings.find((b) => b.date === day && b.status !== 'cancelled' && b.status !== 'no-show'
      && able.includes(b.staffId)
      && toMin(b.time) <= toMin(time) && toMin(b.time) + b.blockMin > toMin(time));
    const why = toMin(time) <= cutoff
      ? t('act.book.pastClock', { roll: rollNote, time: hm12(time), day: relativeDay(day) })
      : holder
        ? t('act.book.takenBy', {
          roll: rollNote,
          time: hm12(time),
          day: relativeDay(day),
          token: tokenLabel(state, holder),
          name: custOf(state, holder.customerId).name,
          staff: staffOf(state, holder.staffId).name,
        })
        : t('act.book.nobodyFree', {
          roll: rollNote, service: svcName(svc), block: svcBlock(svc), time: hm12(time), day: relativeDay(day),
        });
    if (!near) return ask(t('act.book.andNothing', { why }));
    return buildBookProposal(ctx, {
      who, serviceId, staffId, day: near.date, time: near.time, ids: near.staffIds, q,
      lead: t('act.book.nearest', {
        why, day: relativeDay(near.date), time: hm12(near.time), sameDay: near.sameDay,
      }),
    });
  }

  return buildBookProposal(ctx, {
    who, serviceId, staffId, day, time, ids, q,
    lead: t('act.book.open', {
      roll: rollNote,
      time: hm12(time),
      day: relativeDay(day),
      snapped,
      step: state.settings.slotMinutes,
      wanted: wanted ? hm12(wanted) : '',
    }),
  });
}

function buildBookProposal(ctx, o) {
  const state = ctx.state;
  const svc = svcOf(state, o.serviceId);
  const taker = o.ids[0];
  const name = o.who.customer ? o.who.customer.name : o.who.phrase;
  return {
    text: t('act.book.hold', { lead: o.lead, name, isNew: o.who.isNew }),
    table: understood([
      [t('act.book.rows.customer'), o.who.customer
        ? t('act.book.customerLine', { name, phone: o.who.customer.phone })
        : t('act.book.newCustomer', { name })],
      [t('act.book.rows.service'), t('act.book.serviceLine', {
        name: svcName(svc), block: svcBlock(svc), price: `${state.settings.currency}${svc.priceInr}`,
      })],
      [t('act.book.rows.staff'), `${staffOf(state, taker).name}${o.staffId ? t('act.book.staffAsked') : t('act.book.staffFirstFree')}`],
      [t('act.book.rows.day'), t('act.book.dayLine', { rel: relativeDay(o.day), day: dayLabel(o.day) })],
      [t('act.book.rows.time'), t('act.book.timeLine', {
        from: hm12(o.time), to: hm12(toHM(toMin(o.time) + svcBlock(svc))),
      })],
    ]),
    meta: t('act.nothingWritten'),
    actions: [{
      label: t('act.book.action', { time: hm12(o.time), day: relativeDay(o.day) }),
      doingLabel: t('act.book.doing'),
      run: () => runBook(ctx, o),
    }],
  };
}

function runBook(ctx, o) {
  const before = openCount(ctx.state, o.day, o.serviceId, o.staffId);
  const ids = freeStaffAt(ctx.state, o.day, o.time, o.serviceId).filter((id) => !o.staffId || id === o.staffId);
  if (!ids.length) {
    const near = nearestFree(ctx.state, o.day, o.serviceId, o.staffId, o.time);
    return {
      text: t('act.book.wentAway', { nearest: near ? t('bookings.subtitle', { day: relativeDay(near.date), time: hm12(near.time) }) : '' }),
      meta: t('act.nothingChanged'),
      actions: near ? [{
        label: t('act.book.insteadAction', { time: hm12(near.time) }),
        doingLabel: t('act.book.doing'),
        run: () => runBook(ctx, { ...o, day: near.date, time: near.time, ids: near.staffIds }),
      }] : null,
    };
  }

  let customerId = o.who.customer ? o.who.customer.id : null;
  let made = null;
  ctx.store.update((s) => {
    if (!customerId) {
      customerId = `cus-${Math.random().toString(36).slice(2, 8)}`;
      s.customers.push({
        id: customerId, name: o.who.phrase, phone: '+91 ••••• 0000', email: '',
        since: todayKey(), tags: [], note: t('act.book.agentNote'),
      });
    }
    made = createBooking(s, {
      date: o.day, time: o.time, serviceId: o.serviceId, staffId: ids[0],
      customerId, channel: 'Front desk', note: '',
    });
    const fresh = s.bookings.find((b) => b.id === made.id);
    if (fresh) logEvent(fresh, 'bookedByAgent');
  });
  const rec = ctx.state.bookings.find((b) => b.id === made.id);
  const after = openCount(ctx.state, o.day, o.serviceId, o.staffId);
  const svc = svcOf(ctx.state, o.serviceId);
  return {
    text: t('act.book.done', {
      name: custOf(ctx.state, customerId).name,
      service: svcName(svc),
      day: dayLabel(o.day),
      time: hm12(o.time),
      staff: staffOf(ctx.state, ids[0]).name,
    }),
    table: {
      head: t('act.beforeAfter'),
      rows: [
        [t('act.book.rowSlot'), t('act.book.rowSlotOpen'), `**${tokenLabel(ctx.state, rec)}** · ${rec.ref}`],
        [t('act.book.rowFree', { code: svc.code, day: relativeDay(o.day) }), String(before), String(after)],
        [t('act.book.rowSheet'), String(ctx.state.bookings.filter((b) => b.date === o.day && b.status !== 'cancelled').length - 1), String(ctx.state.bookings.filter((b) => b.date === o.day && b.status !== 'cancelled').length)],
      ],
    },
    meta: t('act.book.meta', { ref: rec.ref }),
    suggestions: [t('ans.chips.todayLoad'), t('ans.chips.freeTomorrow'), t('ans.chips.whatCanYouDo')],
    queued: andThen(() => openToken(ctx, rec, { title: t('dialog.bookedTitle') })),
  };
}

/* ============================================================
   2. Reschedule a named booking
   ============================================================ */
function proposeMove(ctx, q) {
  const state = ctx.state;
  const found = matchBooking(state, q);
  if (!found.booking && !found.list.length) {
    return ask(t('act.move.which'));
  }
  if (!found.booking && found.list.length > 1) {
    return {
      text: t('act.move.several', { name: found.label, n: found.list.length }),
      table: {
        head: t('act.move.cols'),
        rows: found.list.slice(0, 5).map((b) => [b.ref, `${relativeDay(b.date)} ${hm12(b.time)}`, svcName(svcOf(state, b.serviceId))]),
      },
      meta: t('act.nothingChanged'),
      actions: found.list.slice(0, 3).map((b) => ({
        label: t('act.move.pickAction', { ref: b.ref, day: relativeDay(b.date), time: hm12(b.time) }),
        doingLabel: t('act.move.reading'),
        run: () => moveTarget(ctx, b, q),
      })),
    };
  }
  const target = found.booking || found.list[0];
  if (!OPEN_STATUSES.includes(target.status)) {
    return ask(t('act.move.alreadyDone', { ref: target.ref, status: (STATUS[target.status] || {}).label }));
  }
  return moveTarget(ctx, target, q);
}

function moveTarget(ctx, target, q) {
  const state = ctx.state;
  const svc = svcOf(state, target.serviceId);
  const asked = matchDay(q) || target.date;
  const day = openDayFrom(state, asked < todayKey() ? todayKey() : asked);
  const wanted = matchTime(state, q);
  const staffId = withStaff(state, q);
  const pinned = staffId || null;

  let time = wanted ? snapToGrid(state, wanted) : null;
  let ids = time ? freeStaffAt(state, day, time, target.serviceId, target.id).filter((id) => !pinned || id === pinned) : [];
  const cutoff = day === todayKey() ? deskNowMin(state.settings) : -1;
  if (time && toMin(time) <= cutoff) ids = [];

  let lead;
  if (!time) {
    const near = nearestFree(state, day, target.serviceId, pinned, target.time, target.id);
    if (!near) return ask(t('act.move.nowhere', { service: svcName(svc), day: relativeDay(day), ref: target.ref }));
    time = near.time; ids = near.staffIds;
    lead = t('act.move.firstOpening', { day: relativeDay(near.date), time: hm12(time) });
    return buildMoveProposal(ctx, target, { day: near.date, time, ids, lead });
  }
  if (!ids.length) {
    const near = nearestFree(state, day, target.serviceId, pinned, time, target.id);
    if (!near) {
      return ask(t('act.move.staysPut', {
        time: hm12(time), day: relativeDay(day), service: svcName(svc), ref: target.ref,
      }));
    }
    lead = t('act.move.nearest', {
      time: hm12(time),
      day: relativeDay(day),
      block: svcBlock(svc),
      service: svcName(svc),
      nearDay: relativeDay(near.date),
      nearTime: hm12(near.time),
    });
    return buildMoveProposal(ctx, target, { day: near.date, time: near.time, ids: near.staffIds, lead });
  }
  lead = t('act.move.fits', { time: hm12(time), day: relativeDay(day), block: svcBlock(svc) });
  return buildMoveProposal(ctx, target, { day, time, ids, lead });
}

function buildMoveProposal(ctx, target, o) {
  const state = ctx.state;
  const cust = custOf(state, target.customerId);
  return {
    text: t('act.move.moving', { lead: o.lead, ref: target.ref, name: cust.name }),
    table: understood([
      [t('act.move.rows.booking'), t('act.move.bookingLine', {
        ref: target.ref, token: tokenLabel(state, target), name: cust.name,
      })],
      [t('act.move.rows.service'), svcName(svcOf(state, target.serviceId))],
      [t('act.move.rows.from'), t('act.move.whenLine', {
        day: dayLabel(target.date), time: hm12(target.time), staff: staffOf(state, target.staffId).name,
      })],
      [t('act.move.rows.to'), t('act.move.whenLine', {
        day: dayLabel(o.day), time: hm12(o.time), staff: staffOf(state, o.ids[0]).name,
      })],
    ]),
    meta: t('act.nothingWritten'),
    actions: [{
      label: t('act.move.action', { day: relativeDay(o.day), time: hm12(o.time) }),
      doingLabel: t('act.move.doing'),
      run: () => runMove(ctx, target, o),
    }],
  };
}

function runMove(ctx, target, o) {
  const before = {
    date: target.date, time: target.time, staffId: target.staffId,
    token: tokenLabel(ctx.state, ctx.state.bookings.find((b) => b.id === target.id) || target),
  };
  const ids = freeStaffAt(ctx.state, o.day, o.time, target.serviceId, target.id).filter((id) => o.ids.includes(id));
  if (!ids.length) {
    return {
      text: t('act.move.filled', { time: hm12(o.time), day: relativeDay(o.day), ref: target.ref }),
      meta: t('act.nothingChanged'),
    };
  }

  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === target.id);
    if (!b) return;
    b.date = o.day;
    b.time = o.time;
    b.staffId = ids[0];
    logEvent(b, 'movedByAgent', {
      fromDay: dayLabel(before.date),
      fromTime: hm12(before.time),
      toDay: dayLabel(o.day),
      toTime: hm12(o.time),
    });
    assignTokens(s.bookings);
  });
  const rec = ctx.state.bookings.find((b) => b.id === target.id);
  return {
    text: t('act.move.done', {
      ref: target.ref, day: dayLabel(o.day), time: hm12(o.time), staff: staffOf(ctx.state, ids[0]).name,
    }),
    table: {
      head: t('act.beforeAfter'),
      rows: [
        [t('act.move.rowWhen'), `${dayLabel(before.date)} ${hm12(before.time)}`, `${dayLabel(o.day)} ${hm12(o.time)}`],
        [t('act.move.rowStaff'), staffOf(ctx.state, before.staffId).name, staffOf(ctx.state, ids[0]).name],
        [t('act.move.rowToken'), before.token, tokenLabel(ctx.state, rec)],
      ],
    },
    meta: t('act.move.meta', { ref: target.ref }),
    suggestions: [t('ans.chips.freeTomorrow'), t('ans.chips.todayLoad'), t('ans.chips.whatCanYouDo')],
    queued: andThen(() => openToken(ctx, rec, { title: t('dialog.movedTitle') })),
  };
}

/* ============================================================
   3. Cancel a booking with a reason
   ============================================================ */
function readReason(q) {
  const m = String(q).match(/\b(?:because|reason:?|since|as)\s+(.{3,120})$/i)
    || String(q).match(/[—,:-]\s*([a-z][^,.;]{4,120})$/i);
  return m ? m[1].trim().replace(/[.\s]+$/, '') : '';
}

function proposeCancel(ctx, q) {
  const state = ctx.state;
  const found = matchBooking(state, q);
  if (!found.booking && !found.list.length) {
    return ask(t('act.cancel.which'));
  }
  if (!found.booking && found.list.length > 1) {
    return {
      text: t('act.cancel.several', { name: found.label, n: found.list.length }),
      table: {
        head: t('act.cancel.cols'),
        rows: found.list.slice(0, 5).map((b) => [b.ref, `${relativeDay(b.date)} ${hm12(b.time)}`, svcName(svcOf(state, b.serviceId))]),
      },
      meta: t('act.nothingChanged'),
      actions: found.list.slice(0, 3).map((b) => ({
        label: t('act.cancel.pickAction', { ref: b.ref }),
        doingLabel: t('act.cancel.doing'),
        run: () => runCancel(ctx, b, readReason(q) || t('act.cancel.defaultReason')),
      })),
    };
  }
  const target = found.booking || found.list[0];
  if (target.status === 'cancelled') return ask(t('act.cancel.already', { ref: target.ref }));
  const cust = custOf(state, target.customerId);
  const reason = readReason(q);
  return {
    text: reason
      ? t('act.cancel.ready', { ref: target.ref })
      : t('act.cancel.needReason', { ref: target.ref }),
    table: understood([
      [t('act.cancel.rows.booking'), t('act.cancel.bookingLine', { ref: target.ref, token: tokenLabel(state, target) })],
      [t('act.cancel.rows.customer'), t('act.cancel.customerLine', { name: cust.name, phone: cust.phone })],
      [t('act.cancel.rows.when'), t('act.cancel.whenLine', {
        day: dayLabel(target.date), time: hm12(target.time), staff: staffOf(state, target.staffId).name,
      })],
      [t('act.cancel.rows.reason'), reason || t('act.cancel.noReason')],
      [t('act.cancel.rows.effect'), t('act.cancel.effect', { n: target.blockMin })],
    ]),
    meta: t('act.nothingWritten'),
    actions: [
      {
        label: reason ? t('act.cancel.action') : t('act.cancel.actionNoReason'),
        doingLabel: t('act.cancel.doing'),
        run: () => runCancel(ctx, target, reason || t('act.cancel.noReasonRecorded')),
      },
    ],
  };
}

function runCancel(ctx, target, reason) {
  const state = ctx.state;
  const rec = state.bookings.find((b) => b.id === target.id);
  if (!rec) return { text: t('act.cancel.gone'), meta: t('act.nothingChanged') };
  const beforeStatus = (STATUS[rec.status] || {}).label || rec.status;
  const beforeFree = openCount(state, rec.date, rec.serviceId, null);
  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === target.id);
    if (!b) return;
    b.status = 'cancelled';
    b.note = b.note ? `${b.note} · ${reason}` : reason;
    logEvent(b, 'cancelledByAgent', { reason });
  });
  return {
    text: t('act.cancel.done', {
      ref: rec.ref,
      name: custOf(ctx.state, rec.customerId).name,
      day: dayLabel(rec.date),
      time: hm12(rec.time),
    }),
    table: {
      head: t('act.beforeAfter'),
      rows: [
        [t('act.cancel.rowStatus'), beforeStatus, t('act.cancel.rowCancelled')],
        [t('act.cancel.rowReason'), t('common.none'), reason],
        [t('act.cancel.rowFree', { day: relativeDay(rec.date) }), String(beforeFree), String(openCount(ctx.state, rec.date, rec.serviceId, null))],
      ],
    },
    meta: t('act.cancel.meta', { ref: rec.ref }),
    suggestions: [t('ans.chips.cancellations'), t('ans.chips.todayLoad'), t('ans.chips.whatCanYouDo')],
  };
}

/* ============================================================
   4. Run the queue — call next, serve, finish, no-show
   ============================================================ */
function todayLive(state) {
  return state.bookings.filter((b) => b.date === todayKey() && b.status !== 'cancelled')
    .sort((a, b) => a.time.localeCompare(b.time));
}

function proposeQueue(ctx, q) {
  const state = ctx.state;
  const day = todayLive(state);
  const text = String(q).toLowerCase();
  const named = matchBooking(state, q);
  const serving = day.find((b) => b.status === 'serving');
  const called = day.find((b) => b.status === 'called');
  const waiting = day.filter((b) => b.status === 'booked');

  const wantNoShow = /no.?show|did ?n.?t turn up|didn'?t show|not turned up|missed it/.test(text);
  const wantDone = /\bserved\b|\bdone\b|\bfinish\w*\b|\bcomplete\w*\b/.test(text);
  const wantStart = /\bstart\w*\b|\bseat\b|\bin the chair\b|\bserving\b/.test(text) && !wantDone;
  const wantCall = /\bcall\b|\bnext token\b|\bnext up\b|\bshout\b/.test(text);

  const target = named.booking && named.booking.date === todayKey() ? named.booking
    : wantNoShow || wantDone ? (serving || called || waiting[0])
      : wantStart ? (called || waiting[0])
        : waiting[0];

  if (!target) {
    return ask(t('act.queue.nothingMatches', {
      tail: day.length
        ? t('act.queue.tailSome', { n: day.length, waiting: waiting.length })
        : t('act.queue.tailNone'),
    }));
  }
  if (!OPEN_STATUSES.includes(target.status)) {
    return ask(t('act.queue.already', {
      token: tokenLabel(state, target), status: (STATUS[target.status] || {}).label,
    }));
  }

  const next = wantNoShow ? 'no-show' : wantDone ? 'done' : wantStart ? 'serving' : 'called';
  const verb = t(`act.queue.verb.${next}`);
  const cust = custOf(state, target.customerId);
  return {
    text: t('act.queue.text', {
      opener: next === 'called' ? t('act.queue.nextInLine') : t('act.queue.thatIs'),
      token: tokenLabel(state, target),
      name: cust.name,
      service: svcName(svcOf(state, target.serviceId)),
      staff: staffOf(state, target.staffId).name,
      time: hm12(target.time),
    })
      + (next === 'no-show' ? t('act.queue.noShowNote', { n: target.blockMin }) : ''),
    table: understood([
      [t('act.queue.rows.token'), t('act.queue.tokenLine', { token: tokenLabel(state, target), ref: target.ref })],
      [t('act.queue.rows.customer'), `${cust.name}${next === 'no-show' ? '' : ''}`],
      [t('act.queue.rows.now'), (STATUS[target.status] || {}).label],
      [t('act.queue.rows.changeTo'), (STATUS[next] || {}).label],
      [t('act.queue.rows.waiting'), t('act.queue.waitingLine', { n: waiting.length })],
    ]),
    meta: t('act.nothingWritten'),
    actions: [
      {
        label: t('act.queue.action', { verb, token: tokenLabel(state, target) }),
        doingLabel: t('act.queue.doing'),
        run: () => runQueue(ctx, target, next),
      },
      next !== 'no-show' && next !== 'done'
        ? { label: t('act.queue.noShowInstead'), doingLabel: t('act.queue.doing'), run: () => runQueue(ctx, target, 'no-show') }
        : null,
    ].filter(Boolean),
  };
}

function runQueue(ctx, target, next) {
  const state = ctx.state;
  const rec = state.bookings.find((b) => b.id === target.id);
  if (!rec) return { text: t('act.queue.gone'), meta: t('act.nothingChanged') };
  const before = (STATUS[rec.status] || {}).label || rec.status;
  const label = tokenLabel(state, rec);
  const beforeDay = todayLive(state);
  const beforeWaiting = beforeDay.filter((b) => b.status === 'booked' || b.status === 'called').length;
  const beforeDone = beforeDay.filter((b) => b.status === 'done').length;
  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === target.id);
    if (!b) return;
    b.status = next;
    const key = {
      called: 'calledByAgent',
      serving: 'seatedByAgent',
      done: 'servedByAgent',
      'no-show': 'noShowByAgent',
    }[next];
    if (key) logEvent(b, key);
    else logEvent(b, 'marked', { status: next });
  });
  const day = todayLive(ctx.state);
  const waiting = day.filter((b) => b.status === 'booked' || b.status === 'called');
  const nowServing = day.find((b) => b.status === 'serving');
  return {
    text: t('act.queue.done', {
      token: label,
      status: (STATUS[next] || {}).label,
      chair: nowServing
        ? t('act.queue.atChair', {
          token: tokenLabel(ctx.state, nowServing),
          name: custOf(ctx.state, nowServing.customerId).name,
        })
        : t('act.queue.nobodyAtChair'),
    }),
    table: {
      head: t('act.beforeAfter'),
      rows: [
        [label, before, `**${(STATUS[next] || {}).label}**`],
        [t('act.queue.rowWaiting'), String(beforeWaiting), String(waiting.length)],
        [t('act.queue.rowServed'), String(beforeDone), String(day.filter((b) => b.status === 'done').length)],
      ],
    },
    meta: t('act.queue.meta'),
    suggestions: [t('ans.chips.callNext'), t('ans.chips.queueNow'), t('ans.chips.todayLoad')],
  };
}

/* ============================================================
   5. Block part of a staff member's day
   ============================================================ */
function proposeBlock(ctx, q) {
  const state = ctx.state;
  const staffId = matchStaff(state, q);
  if (!staffId) return ask(t('act.block.whoFor', { list: state.staff.map((s) => s.name).join(', ') }));
  const st = staffOf(state, staffId);
  const asked = matchDay(q) || todayKey();
  const day = asked;
  if (!staffWorks(state, staffId, day)) {
    return ask(t('act.block.notOnShift', {
      staff: st.name,
      day: dayLabel(day),
      days: st.days.map((d) => dowLong(d).slice(0, 3)).join(', '),
      closed: !isOpenDay(state, day),
    }));
  }
  const win = matchWindow(state, q, staffId, day, deskNowMin(state.settings));
  if (!win) {
    return ask(t('act.block.whichPart', { staff: st.name, day: relativeDay(day) }));
  }

  const s = toMin(win.start);
  const e = toMin(win.end);
  const clash = state.bookings.filter((b) => b.staffId === staffId && b.date === day
    && OPEN_STATUSES.includes(b.status)
    && toMin(b.time) < e && toMin(b.time) + b.blockMin > s)
    .sort((a, b) => a.time.localeCompare(b.time));

  if (clash.length) {
    return {
      text: t('act.block.clash', {
        staff: st.name, n: clash.length, window: win.label, day: relativeDay(day),
      }),
      table: {
        head: t('act.block.cols'),
        rows: clash.map((b) => [tokenLabel(state, b), hm12(b.time), custOf(state, b.customerId).name]),
      },
      meta: t('act.nothingWritten'),
      actions: [
        { label: t('act.block.freeOnly'), doingLabel: t('act.block.doing'), run: () => runBlock(ctx, { staffId, day, start: win.start, end: win.end, label: win.label, around: clash.map((b) => b.id) }) },
        { label: t('act.block.cancelAll', { n: clash.length }), doingLabel: t('act.block.doing'), run: () => runBlock(ctx, { staffId, day, start: win.start, end: win.end, label: win.label, cancel: clash.map((b) => b.id) }) },
      ],
    };
  }

  return {
    text: t('act.block.clear', { window: win.label, staff: st.name, day: relativeDay(day) }),
    table: understood([
      [t('act.block.rows.staff'), t('act.block.staffLine', { name: st.name, role: staffRole(st) })],
      [t('act.block.rows.day'), t('act.block.dayLine', { rel: relativeDay(day), day: dayLabel(day) })],
      [t('act.block.rows.window'), t('act.block.windowLine', { from: hm12(win.start), to: hm12(win.end), mins: e - s })],
      [t('act.block.rows.hits'), t('act.block.noneHit')],
      [t('act.block.rows.effect'), t('act.block.effect')],
    ]),
    meta: t('act.nothingWritten'),
    actions: [{
      label: t('act.block.action', { from: hm12(win.start), to: hm12(win.end) }),
      doingLabel: t('act.block.doing'),
      run: () => runBlock(ctx, { staffId, day, start: win.start, end: win.end, label: win.label }),
    }],
  };
}

function runBlock(ctx, o) {
  const state = ctx.state;
  const st = staffOf(state, o.staffId);
  const skill = st.skills.find((id) => svcOf(state, id).active) || st.skills[0];
  const before = openCount(state, o.day, skill, o.staffId);
  const cancelled = [];

  ctx.store.update((s) => {
    if (o.cancel) {
      for (const id of o.cancel) {
        const b = s.bookings.find((x) => x.id === id);
        if (!b) continue;
        b.status = 'cancelled';
        logEvent(b, 'cancelledForBlock', { label: o.label, staff: st.name });
        cancelled.push(b.ref);
      }
    }
    /* "free time only" splits the window around whatever is still standing. */
    let pieces = [[toMin(o.start), toMin(o.end)]];
    if (o.around) {
      for (const id of o.around) {
        const b = s.bookings.find((x) => x.id === id);
        if (!b) continue;
        const bs = toMin(b.time);
        const be = bs + b.blockMin;
        pieces = pieces.flatMap(([ps, pe]) => {
          if (be <= ps || bs >= pe) return [[ps, pe]];
          const out = [];
          if (bs > ps) out.push([ps, bs]);
          if (be < pe) out.push([be, pe]);
          return out;
        });
      }
    }
    for (const [ps, pe] of pieces) {
      if (pe - ps < 5) continue;
      addBlock(s, { staffId: o.staffId, date: o.day, start: toHM(ps), end: toHM(pe), reason: t('act.block.reason', { label: o.label }) });
    }
  });

  const held = blocksOn(ctx.state, o.staffId, o.day);
  const mins = held.reduce((n, x) => n + (toMin(x.end) - toMin(x.start)), 0);
  return {
    text: t('act.block.done', {
      staff: st.name,
      windows: held.map((x) => `${hm12(x.start)}–${hm12(x.end)}`).join(', '),
      day: dayLabel(o.day),
    })
      + (cancelled.length ? t('act.block.cancelledToo', { refs: cancelled.join(', ') }) : ''),
    table: {
      head: t('act.beforeAfter'),
      rows: [
        [t('act.block.rowBookable', { code: svcOf(ctx.state, skill).code }), String(before), String(openCount(ctx.state, o.day, skill, o.staffId))],
        [t('act.block.rowHeld'), t('act.block.zeroMin'), t('act.block.mins', { n: mins })],
        [t('act.block.rowCancelled'), '0', String(cancelled.length)],
      ],
    },
    meta: t('act.block.meta'),
    suggestions: [t('ans.chips.freeTomorrow'), t('ans.chips.staffWorkload'), t('ans.chips.whatCanYouDo')],
  };
}

/* ============================================================
   6. Change a service duration or price
   ============================================================ */
function proposeService(ctx, q) {
  const state = ctx.state;
  const serviceId = matchService(state, q);
  if (!serviceId) return ask(t('act.service.which', { list: state.services.map((s) => svcName(s)).join(', ') }));
  const svc = svcOf(state, serviceId);
  const text = String(q).toLowerCase();

  const wantsPrice = /\bprice|\bcost|\bcharge|\bfee|₹|\brs\b|\brupees?\b/.test(text);
  const wantsMinutes = /\bminute|\bmins?\b|\bduration|\blong\b|\bblock\b|\bbuffer\b/.test(text);
  const wantsBuffer = /\bbuffer\b/.test(text);

  let field = wantsPrice && !wantsMinutes ? 'price' : wantsMinutes ? (wantsBuffer ? 'buffer' : 'duration') : null;
  if (!field) return ask(t('act.service.whichField'));

  let value = field === 'price'
    ? (matchNumber(q, '\\bto\\b') ?? matchNumber(q, '\\b(?:price|cost|charge|fee|rs|rupees)\\b|₹') ?? matchNumber(q))
    : (matchNumber(q, '\\b(?:to|at)\\b') ?? matchNumber(q));
  if (field !== 'price') {
    const m = text.match(/(\d{1,3})\s*(?:min|mins|minutes)/);
    if (m) value = Number(m[1]);
  }
  if (!value || value <= 0) {
    return ask(t('act.service.noNumber', {
      service: svcName(svc),
      field: t(`act.service.fieldNames.${field}`),
      example: field === 'price'
        ? t('act.service.exPrice', { lower: svcName(svc).toLowerCase() })
        : t('act.service.exMinutes', { lower: svcName(svc).toLowerCase() }),
    }));
  }
  if (field !== 'price' && value > 240) return ask(t('act.service.tooLong', { n: value }));
  if (field === 'price' && value > 100000) return ask(t('act.service.tooDear', { price: `${state.settings.currency}${value}` }));

  const before = { duration: svc.durationMin, buffer: svc.bufferMin, price: svc.priceInr };
  const after = { ...before, [field]: value };
  if (before[field] === value) {
    return ask(t('act.service.already', {
      service: svcName(svc),
      value: field === 'price' ? `${state.settings.currency}${value}` : t('act.service.minutes', { n: value }),
    }));
  }

  const newBlock = after.duration + after.buffer;
  const future = state.bookings.filter((b) => b.serviceId === serviceId && OPEN_STATUSES.includes(b.status) && b.date >= todayKey());

  return {
    text: t('act.service.changing', { field: t(`act.service.fieldNames.${field}`), service: svcName(svc) })
      + (field === 'price'
        ? t('act.service.priceNote', { n: future.length })
        : t('act.service.blockNote', { from: before.duration + before.buffer, to: newBlock, n: future.length })),
    table: understood([
      [t('act.service.rows.service'), t('act.service.serviceLine', { name: svcName(svc), code: svc.code })],
      [t('act.service.rows.field'), t(`act.service.fieldLabels.${field}`)],
      [t('act.service.rows.before'), field === 'price' ? `${state.settings.currency}${before.price}` : t('act.service.minutes', { n: before[field] })],
      [t('act.service.rows.after'), field === 'price' ? `${state.settings.currency}${value}` : t('act.service.minutes', { n: value })],
      [t('act.service.rows.affected'), String(future.length)],
    ]),
    meta: t('act.nothingWritten'),
    actions: [{
      label: t('act.service.action', {
        field: t(`act.service.fieldNames.${field}`),
        value: field === 'price' ? `${state.settings.currency}${value}` : t('act.service.minutes', { n: value }),
      }),
      doingLabel: t('act.service.doing'),
      run: () => runService(ctx, serviceId, field, value, before),
    }],
  };
}

function runService(ctx, serviceId, field, value, before) {
  const key = field === 'price' ? 'priceInr' : field === 'buffer' ? 'bufferMin' : 'durationMin';
  let retimed = 0;
  let left = 0;
  ctx.store.update((s) => {
    const svc = s.services.find((x) => x.id === serviceId);
    if (!svc) return;
    svc[key] = value;
    if (field !== 'price') {
      const block = svc.durationMin + svc.bufferMin;
      for (const b of s.bookings) {
        if (b.serviceId !== serviceId || !OPEN_STATUSES.includes(b.status) || b.date < todayKey()) continue;
        if (b.blockMin === block) continue;
        const old = b.blockMin;
        b.blockMin = block;
        /* staffFree ignores this record, so a longer block that now runs into
           the next appointment or off the end of the shift is put back. */
        const st = s.staff.find((x) => x.id === b.staffId);
        const fits = st && (() => {
          const bs = toMin(b.time);
          if (bs + block > toMin(st.end)) return false;
          if (bs < toMin(st.breakEnd) && bs + block > toMin(st.breakStart)) return false;
          return !s.bookings.some((o) => o.id !== b.id && o.staffId === b.staffId && o.date === b.date
            && o.status !== 'cancelled' && o.status !== 'no-show'
            && bs < toMin(o.time) + o.blockMin && bs + block > toMin(o.time));
        })();
        if (fits) { retimed += 1; logEvent(b, 'blockChanged', { n: block }); }
        else { b.blockMin = old; left += 1; }
      }
    }
  });
  const svc = svcOf(ctx.state, serviceId);
  return {
    text: t('act.service.done', {
      service: svcName(svc),
      duration: svc.durationMin,
      buffer: svc.bufferMin,
      price: `${ctx.state.settings.currency}${svc.priceInr}`,
    })
      + (field === 'price' ? '' : t('act.service.retimed', { retimed, left })),
    table: {
      head: t('act.beforeAfter'),
      rows: [
        [t('act.service.rowDuration'), t('act.service.minutes', { n: before.duration }), t('act.service.minutes', { n: svc.durationMin })],
        [t('act.service.rowBuffer'), t('act.service.minutes', { n: before.buffer }), t('act.service.minutes', { n: svc.bufferMin })],
        [t('act.service.rowPrice'), `${ctx.state.settings.currency}${before.price}`, `${ctx.state.settings.currency}${svc.priceInr}`],
      ],
    },
    meta: t('act.service.meta'),
    suggestions: [t('ans.chips.earnsMost'), t('ans.chips.freeTomorrow'), t('ans.chips.whatCanYouDo')],
  };
}

/* ============================================================
   what the agent can do — used by the intent and by the About modal
   ============================================================ */
/* The About modal's worked examples. Read from the dictionary on demand so
   they are shown in the language the reader chose. */
export const actionExamples = () => t('act.examples');


function helpAnswer(state) {
  return {
    text: t('act.help.text'),
    table: {
      head: t('act.help.cols'),
      rows: actionExamples().map((e) => [`**${e.title}**\n\`${e.input}\``, e.output]),
    },
    meta: t('act.help.meta', {
      bookings: state.bookings.length,
      services: state.services.length,
      staff: state.staff.length,
    }),
    suggestions: actionChips(),
  };
}

/* ---------- the intents ---------- */
export function actionIntents(ctx) {
  return [
    {
      id: 'act-book',
      match: [/\b(?:book|schedule|register)\b(?!\w)|\bmake an appointment\b|\badd (?:a |an )?(?:booking|appointment)\b|\bput .* (?:in|down) for\b/i, 'book ', 'schedule '],
      trace: t('act.trace.book'),
      answer: (q) => proposeBook(ctx, q),
    },
    {
      id: 'act-move',
      match: [/\b(?:reschedule|rebook|move|push|shift|bring forward)\b/i, 'reschedule', 'move '],
      trace: t('act.trace.move'),
      answer: (q) => proposeMove(ctx, q),
    },
    {
      id: 'act-cancel',
      match: [/\bcancel\b|\bcall(?:ed)? off\b|\bdrop\b|\bscrap\b/i, 'cancel '],
      trace: t('act.trace.cancel'),
      answer: (q) => proposeCancel(ctx, q),
    },
    {
      id: 'act-queue',
      match: [/\bcall (?:the )?next\b|\bnext token\b|\bmark\b.*\b(?:served|done|no.?show|serving)\b|\bseat\b|\bfinish(?:ed)?\b.*\b(?:token|current)\b|\b(?:did ?n.?t|did not|never) turn(?:ed)? up\b/i,
        'call next', 'call the next', 'turn up'],
      trace: t('act.trace.queue'),
      answer: (q) => proposeQueue(ctx, q),
    },
    {
      id: 'act-block',
      match: [/\bblock\b|\bhold back\b|\bkeep .* free\b|\bmark .* (?:unavailable|off)\b|\btake .* off the grid\b/i, 'block '],
      trace: t('act.trace.block'),
      answer: (q) => proposeBlock(ctx, q),
    },
    {
      id: 'act-service',
      match: [/\b(?:change|set|make|update|raise|drop|reduce|increase)\b[^?]*\b(?:price|cost|charge|fee|duration|minutes?|mins?|buffer)\b/i, 'price to', 'minutes'],
      trace: t('act.trace.service'),
      answer: (q) => proposeService(ctx, q),
    },
    {
      id: 'act-help',
      match: [/what can you do|what are you able|help me|\bcommands?\b|what can i ask|things you can do|can you (?:change|do)/i, 'what can you do'],
      trace: t('act.trace.help'),
      answer: (q, state) => helpAnswer(state),
    },
  ];
}

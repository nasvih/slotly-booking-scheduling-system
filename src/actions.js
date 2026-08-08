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
  addBlock, gridSlots, STATUS, DOW_LONG, OPEN_STATUSES,
} from './data.js';
import {
  matchDay, matchService, matchStaff, withStaff, matchCustomer, matchTime,
  snapToGrid, matchBooking, matchWindow, matchNumber, bookingCustomer,
} from './parse.js';
import { openToken } from './token.js';

/* ---------- shared shapes ---------- */
const ask = (text, suggestions) => ({ text, suggestions: suggestions || ACTION_CHIPS, meta: 'nothing changed' });
const understood = (rows) => ({ head: ['I read this as', ''], rows });

/**
 * The panel awaits whatever run() returns, so the result object must not carry
 * a `then` — a plain object with a then function is a thenable and would hang
 * the await forever. Anything that should happen after the reply lands is
 * queued instead.
 */
const andThen = (fn) => { setTimeout(fn, 160); };

export const ACTION_CHIPS = [
  'What can you do?',
  'Book Meera for a dental check-up tomorrow at 11',
  'Call the next token',
  "Block Nithya's afternoon tomorrow",
];

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
  if (!active.length) return ask('Every service is switched off in Services, so there is nothing bookable. Turn one back on and ask me again.');

  const who = bookingCustomer(state, q);
  const serviceId = matchService(state, q);
  if (!serviceId) {
    return ask(`I could not tell which service that is. Name one of: ${active.map((s) => s.name).join(', ')}.`
      + '\n\nFor example: `book Meera for a dental check-up tomorrow at 11`.');
  }
  const svc = svcOf(state, serviceId);
  if (!svc.active) return ask(`**${svc.name}** is switched off in Services, so I cannot put anything in the diary against it. Switch it back on first.`);
  if (!who.phrase) {
    return ask(`I have the service — **${svc.name}** — but not who it is for. Put the name in, like \`book Meera Nair for ${svc.name.toLowerCase()} tomorrow at 11\`.`);
  }

  /* A day that has gone, or a day the desk does not open, is corrected forward
     rather than refused outright — the reply says so before anything is held. */
  const asked = matchDay(q) || todayKey();
  const past = asked < todayKey();
  const day = openDayFrom(state, past ? todayKey() : asked);
  const rollNote = past
    ? `${dayLabel(asked)} has already gone, so I looked at ${relativeDay(day)} instead. `
    : day !== asked
      ? `The desk is closed on ${DOW_LONG[parseDay(asked).getDay()]}, so I looked at ${relativeDay(day)} instead. `
      : '';
  const staffId = withStaff(state, q);
  if (staffId && !staffOf(state, staffId).skills.includes(serviceId)) {
    const other = state.staff.filter((s) => s.active && s.skills.includes(serviceId)).map((s) => s.name);
    return ask(`**${staffOf(state, staffId).name}** does not take ${svc.name}. That one is covered by ${other.join(' and ') || 'nobody on the rota'}.`);
  }
  if (staffId && !staffWorks(state, staffId, day)) {
    return ask(`**${staffOf(state, staffId).name}** is not on the rota on ${dayLabel(day)} — they work ${staffOf(state, staffId).days.map((d) => DOW_LONG[d].slice(0, 3)).join(', ')}. Pick another day or leave the name out and I will find whoever is free.`);
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
    if (!near) return ask(`Nothing opens for **${svc.name}**${staffId ? ` with ${staffOf(state, staffId).name}` : ''} in the next three weeks, so I have nothing to offer ${who.phrase}.`);
    time = near.time;
    ids = near.staffIds;
    return buildBookProposal(ctx, {
      who, serviceId, staffId, day: near.date, time, ids, q,
      lead: `${rollNote}No time in that, so I took the first opening: **${relativeDay(near.date)} at ${hm12(time)}**.`,
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
      ? `${rollNote}${hm12(time)} on ${relativeDay(day)} has already gone past on the desk clock.`
      : holder
        ? `${rollNote}${hm12(time)} on ${relativeDay(day)} is taken — ${tokenLabel(state, holder)}, ${custOf(state, holder.customerId).name} with ${staffOf(state, holder.staffId).name}.`
        : `${rollNote}Nobody with the ${svc.name} skill is free for the whole ${svcBlock(svc)} minute block at ${hm12(time)} on ${relativeDay(day)}.`;
    if (!near) return ask(`${why}\n\nAnd nothing else opens up in the next three weeks either.`);
    return buildBookProposal(ctx, {
      who, serviceId, staffId, day: near.date, time: near.time, ids: near.staffIds, q,
      lead: `${why}\n\nThe nearest free one is **${relativeDay(near.date)} at ${hm12(near.time)}**${near.sameDay ? '' : ' — the first opening after that day'}.`,
    });
  }

  return buildBookProposal(ctx, {
    who, serviceId, staffId, day, time, ids, q,
    lead: `${rollNote}**${hm12(time)} on ${relativeDay(day)}** is open${snapped ? ` (nearest slot on the ${state.settings.slotMinutes} minute grid to ${hm12(wanted)})` : ''}.`,
  });
}

function buildBookProposal(ctx, o) {
  const state = ctx.state;
  const svc = svcOf(state, o.serviceId);
  const taker = o.ids[0];
  const name = o.who.customer ? o.who.customer.name : o.who.phrase;
  return {
    text: `${o.lead}\n\nI will hold it for **${name}**${o.who.isNew ? ' — a new customer record, since nobody by that name is on file' : ''}.`,
    table: understood([
      ['Customer', o.who.customer ? `${name} · ${o.who.customer.phone}` : `${name} (new)`],
      ['Service', `${svc.name} · ${svcBlock(svc)} min block · ${state.settings.currency}${svc.priceInr}`],
      ['Staff', `${staffOf(state, taker).name}${o.staffId ? ' (as asked)' : ' — first free with the skill'}`],
      ['Day', `${relativeDay(o.day)} · ${dayLabel(o.day)}`],
      ['Time', `${hm12(o.time)} — ${hm12(toHM(toMin(o.time) + svcBlock(svc)))}`],
    ]),
    meta: 'nothing written yet',
    actions: [{
      label: `Book ${hm12(o.time)} on ${relativeDay(o.day)}`,
      doingLabel: 'Booking…',
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
      text: `That slot went while we were talking. Nothing was written.${near ? `\n\nThe nearest free one now is **${relativeDay(near.date)} at ${hm12(near.time)}**.` : ''}`,
      meta: 'nothing changed',
      actions: near ? [{ label: `Book ${hm12(near.time)} instead`, doingLabel: 'Booking…', run: () => runBook(ctx, { ...o, day: near.date, time: near.time, ids: near.staffIds }) }] : null,
    };
  }

  let customerId = o.who.customer ? o.who.customer.id : null;
  let made = null;
  ctx.store.update((s) => {
    if (!customerId) {
      customerId = `cus-${Math.random().toString(36).slice(2, 8)}`;
      s.customers.push({
        id: customerId, name: o.who.phrase, phone: '+91 ••••• 0000', email: '',
        since: todayKey(), tags: [], note: 'Added by the desk agent',
      });
    }
    made = createBooking(s, {
      date: o.day, time: o.time, serviceId: o.serviceId, staffId: ids[0],
      customerId, channel: 'Front desk', note: '',
    });
    const fresh = s.bookings.find((b) => b.id === made.id);
    if (fresh) logEvent(fresh, 'Booked by the desk agent from a typed request');
  });
  const rec = ctx.state.bookings.find((b) => b.id === made.id);
  const after = openCount(ctx.state, o.day, o.serviceId, o.staffId);
  const svc = svcOf(ctx.state, o.serviceId);
  return {
    text: `Booked. **${custOf(ctx.state, customerId).name}** has ${svc.name} on **${dayLabel(o.day)} at ${hm12(o.time)}** with ${staffOf(ctx.state, ids[0]).name}.`,
    table: {
      head: ['', 'Before', 'After'],
      rows: [
        ['That slot', 'open', `**${tokenLabel(ctx.state, rec)}** · ${rec.ref}`],
        [`Free ${svc.code} slots on ${relativeDay(o.day)}`, String(before), String(after)],
        ['On the day sheet', String(ctx.state.bookings.filter((b) => b.date === o.day && b.status !== 'cancelled').length - 1), String(ctx.state.bookings.filter((b) => b.date === o.day && b.status !== 'cancelled').length)],
      ],
    },
    meta: `${rec.ref} written · showing on Today and the calendar`,
    suggestions: ["Today's load", 'Free slots tomorrow', 'What can you do?'],
    queued: andThen(() => openToken(ctx, rec, { title: 'Booked' })),
  };
}

/* ============================================================
   2. Reschedule a named booking
   ============================================================ */
function proposeMove(ctx, q) {
  const state = ctx.state;
  const found = matchBooking(state, q);
  if (!found.booking && !found.list.length) {
    return ask('I could not tell which booking to move. Give me the reference, the token or the customer name — `move SL-1042 to Thursday at 11` or `reschedule Meera to tomorrow 3pm`.');
  }
  if (!found.booking && found.list.length > 1) {
    return {
      text: `**${found.label}** has ${found.list.length} bookings still open, so I will not guess which one to move. Pick one.`,
      table: {
        head: ['Ref', 'When', 'Service'],
        rows: found.list.slice(0, 5).map((b) => [b.ref, `${relativeDay(b.date)} ${hm12(b.time)}`, svcOf(state, b.serviceId).name]),
      },
      meta: 'nothing changed',
      actions: found.list.slice(0, 3).map((b) => ({
        label: `${b.ref} · ${relativeDay(b.date)} ${hm12(b.time)}`,
        doingLabel: 'Reading…',
        run: () => moveTarget(ctx, b, q),
      })),
    };
  }
  const target = found.booking || found.list[0];
  if (!OPEN_STATUSES.includes(target.status)) {
    return ask(`**${target.ref}** is already ${(STATUS[target.status] || {}).label.toLowerCase()}, so there is nothing to move.`);
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
    if (!near) return ask(`Nothing is open for **${svc.name}** on ${relativeDay(day)} or in the three weeks after it, so **${target.ref}** has nowhere to go.`);
    time = near.time; ids = near.staffIds;
    lead = `No time in that, so I took the first opening on ${relativeDay(near.date)}: **${hm12(time)}**.`;
    return buildMoveProposal(ctx, target, { day: near.date, time, ids, lead });
  }
  if (!ids.length) {
    const near = nearestFree(state, day, target.serviceId, pinned, time, target.id);
    if (!near) return ask(`${hm12(time)} on ${relativeDay(day)} is not free, and nothing else opens for ${svc.name} in the next three weeks. **${target.ref}** stays where it is.`);
    lead = `**${hm12(time)} on ${relativeDay(day)}** is not free for a ${svcBlock(svc)} minute ${svc.name}. The nearest one that is: **${relativeDay(near.date)} at ${hm12(near.time)}**.`;
    return buildMoveProposal(ctx, target, { day: near.date, time: near.time, ids: near.staffIds, lead });
  }
  lead = `**${hm12(time)} on ${relativeDay(day)}** is open and holds the full ${svcBlock(svc)} minutes.`;
  return buildMoveProposal(ctx, target, { day, time, ids, lead });
}

function buildMoveProposal(ctx, target, o) {
  const state = ctx.state;
  const cust = custOf(state, target.customerId);
  return {
    text: `${o.lead}\n\nMoving **${target.ref}** for ${cust.name}.`,
    table: understood([
      ['Booking', `${target.ref} · ${tokenLabel(state, target)} · ${cust.name}`],
      ['Service', svcOf(state, target.serviceId).name],
      ['From', `${dayLabel(target.date)} ${hm12(target.time)} · ${staffOf(state, target.staffId).name}`],
      ['To', `${dayLabel(o.day)} ${hm12(o.time)} · ${staffOf(state, o.ids[0]).name}`],
    ]),
    meta: 'nothing written yet',
    actions: [{
      label: `Move to ${relativeDay(o.day)} ${hm12(o.time)}`,
      doingLabel: 'Moving…',
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
  if (!ids.length) return { text: `${hm12(o.time)} on ${relativeDay(o.day)} filled up while we were talking. **${target.ref}** has not been moved.`, meta: 'nothing changed' };

  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === target.id);
    if (!b) return;
    b.date = o.day;
    b.time = o.time;
    b.staffId = ids[0];
    logEvent(b, `Moved from ${dayLabel(before.date)} ${hm12(before.time)} to ${dayLabel(o.day)} ${hm12(o.time)} by the desk agent`);
    assignTokens(s.bookings);
  });
  const rec = ctx.state.bookings.find((b) => b.id === target.id);
  return {
    text: `Moved. **${target.ref}** now sits on **${dayLabel(o.day)} at ${hm12(o.time)}** with ${staffOf(ctx.state, ids[0]).name}. The old slot is back on the grid.`,
    table: {
      head: ['', 'Before', 'After'],
      rows: [
        ['When', `${dayLabel(before.date)} ${hm12(before.time)}`, `${dayLabel(o.day)} ${hm12(o.time)}`],
        ['Staff', staffOf(ctx.state, before.staffId).name, staffOf(ctx.state, ids[0]).name],
        ['Token', before.token, tokenLabel(ctx.state, rec)],
      ],
    },
    meta: `${target.ref} updated · the calendar and Today already show it`,
    suggestions: ['Free slots tomorrow', "Today's load", 'What can you do?'],
    queued: andThen(() => openToken(ctx, rec, { title: 'Moved' })),
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
    return ask('I could not tell which booking to cancel. Name it — `cancel SL-1042 because the customer is unwell`.');
  }
  if (!found.booking && found.list.length > 1) {
    return {
      text: `**${found.label}** has ${found.list.length} open bookings. I will not cancel on a guess — pick the one you mean.`,
      table: { head: ['Ref', 'When', 'Service'], rows: found.list.slice(0, 5).map((b) => [b.ref, `${relativeDay(b.date)} ${hm12(b.time)}`, svcOf(state, b.serviceId).name]) },
      meta: 'nothing changed',
      actions: found.list.slice(0, 3).map((b) => ({
        label: `Cancel ${b.ref}`,
        doingLabel: 'Cancelling…',
        run: () => runCancel(ctx, b, readReason(q) || 'Cancelled at the front desk'),
      })),
    };
  }
  const target = found.booking || found.list[0];
  if (target.status === 'cancelled') return ask(`**${target.ref}** is already cancelled — nothing to do.`);
  const cust = custOf(state, target.customerId);
  const reason = readReason(q);
  return {
    text: reason
      ? `Ready to cancel **${target.ref}** and log the reason against it.`
      : `Ready to cancel **${target.ref}**, but you have not given me a reason and the record keeps one. Add it — \`cancel ${target.ref} because the customer is unwell\` — or press through without one.`,
    table: understood([
      ['Booking', `${target.ref} · ${tokenLabel(state, target)}`],
      ['Customer', `${cust.name} · ${cust.phone}`],
      ['When', `${dayLabel(target.date)} ${hm12(target.time)} · ${staffOf(state, target.staffId).name}`],
      ['Reason', reason || 'none given'],
      ['Effect', `${target.blockMin} minutes go back on the grid`],
    ]),
    meta: 'nothing written yet',
    actions: [
      { label: reason ? 'Cancel it' : 'Cancel without a reason', doingLabel: 'Cancelling…', run: () => runCancel(ctx, target, reason || 'Cancelled at the front desk, no reason recorded') },
    ],
  };
}

function runCancel(ctx, target, reason) {
  const state = ctx.state;
  const rec = state.bookings.find((b) => b.id === target.id);
  if (!rec) return { text: 'That record is no longer in the store, so nothing was changed.', meta: 'nothing changed' };
  const beforeStatus = (STATUS[rec.status] || {}).label || rec.status;
  const beforeFree = openCount(state, rec.date, rec.serviceId, null);
  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === target.id);
    if (!b) return;
    b.status = 'cancelled';
    b.note = b.note ? `${b.note} · ${reason}` : reason;
    logEvent(b, `Cancelled by the desk agent — ${reason}`);
  });
  return {
    text: `Cancelled. **${rec.ref}** for ${custOf(ctx.state, rec.customerId).name} on ${dayLabel(rec.date)} at ${hm12(rec.time)} is off the sheet, and the reason is on the record.`,
    table: {
      head: ['', 'Before', 'After'],
      rows: [
        ['Status', beforeStatus, '**Cancelled**'],
        ['Reason on file', '—', reason],
        [`Free slots on ${relativeDay(rec.date)}`, String(beforeFree), String(openCount(ctx.state, rec.date, rec.serviceId, null))],
      ],
    },
    meta: `${rec.ref} released · Today and the calendar are already updated`,
    suggestions: ['Cancellations this week', "Today's load", 'What can you do?'],
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
    return ask(`Nothing on today's sheet matches that. ${day.length ? `There are ${day.length} bookings today, ${waiting.length} still waiting.` : 'Today has no bookings at all.'}`);
  }
  if (!OPEN_STATUSES.includes(target.status)) {
    return ask(`**${tokenLabel(state, target)}** is already ${(STATUS[target.status] || {}).label.toLowerCase()}. Pick another token, or ask me for the queue.`);
  }

  const next = wantNoShow ? 'no-show' : wantDone ? 'done' : wantStart ? 'serving' : 'called';
  const verb = { called: 'Call', serving: 'Seat', done: 'Mark served', 'no-show': 'Mark no-show' }[next];
  const cust = custOf(state, target.customerId);
  return {
    text: `${verb === 'Call' ? 'Next in line is' : 'That is'} **${tokenLabel(state, target)}** — ${cust.name}, ${svcOf(state, target.serviceId).name} with ${staffOf(state, target.staffId).name} at ${hm12(target.time)}.`
      + (next === 'no-show' ? `\n\nMarking it a no-show puts ${target.blockMin} minutes back on the grid and counts against this customer's record.` : ''),
    table: understood([
      ['Token', `${tokenLabel(state, target)} · ${target.ref}`],
      ['Customer', `${cust.name}${next === 'no-show' ? '' : ''}`],
      ['Now', (STATUS[target.status] || {}).label],
      ['Change to', (STATUS[next] || {}).label],
      ['Still waiting', `${waiting.length} token${waiting.length === 1 ? '' : 's'}`],
    ]),
    meta: 'nothing written yet',
    actions: [
      { label: `${verb} ${tokenLabel(state, target)}`, doingLabel: 'Updating…', run: () => runQueue(ctx, target, next) },
      next !== 'no-show' && next !== 'done'
        ? { label: 'Mark it a no-show instead', doingLabel: 'Updating…', run: () => runQueue(ctx, target, 'no-show') }
        : null,
    ].filter(Boolean),
  };
}

function runQueue(ctx, target, next) {
  const state = ctx.state;
  const rec = state.bookings.find((b) => b.id === target.id);
  if (!rec) return { text: 'That token is no longer on today\'s sheet.', meta: 'nothing changed' };
  const before = (STATUS[rec.status] || {}).label || rec.status;
  const label = tokenLabel(state, rec);
  const beforeDay = todayLive(state);
  const beforeWaiting = beforeDay.filter((b) => b.status === 'booked' || b.status === 'called').length;
  const beforeDone = beforeDay.filter((b) => b.status === 'done').length;
  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === target.id);
    if (!b) return;
    b.status = next;
    logEvent(b, {
      called: 'Called to the desk by the agent',
      serving: 'Seated by the agent',
      done: 'Marked served by the agent',
      'no-show': 'Marked a no-show by the agent',
    }[next] || `Marked ${next}`);
  });
  const day = todayLive(ctx.state);
  const waiting = day.filter((b) => b.status === 'booked' || b.status === 'called');
  const nowServing = day.find((b) => b.status === 'serving');
  return {
    text: `**${label}** is now ${(STATUS[next] || {}).label.toLowerCase()}. ${nowServing ? `At the chair: ${tokenLabel(ctx.state, nowServing)} — ${custOf(ctx.state, nowServing.customerId).name}.` : 'Nobody is at the chair.'}`,
    table: {
      head: ['', 'Before', 'After'],
      rows: [
        [label, before, `**${(STATUS[next] || {}).label}**`],
        ['Waiting', String(beforeWaiting), String(waiting.length)],
        ['Served today', String(beforeDone), String(day.filter((b) => b.status === 'done').length)],
      ],
    },
    meta: 'Today is already redrawn',
    suggestions: ['Call the next token', 'Queue right now', "Today's load"],
  };
}

/* ============================================================
   5. Block part of a staff member's day
   ============================================================ */
function proposeBlock(ctx, q) {
  const state = ctx.state;
  const staffId = matchStaff(state, q);
  if (!staffId) return ask(`Name the person — \`block Nithya's afternoon tomorrow\`. On the rota: ${state.staff.map((s) => s.name).join(', ')}.`);
  const st = staffOf(state, staffId);
  const asked = matchDay(q) || todayKey();
  const day = asked;
  if (!staffWorks(state, staffId, day)) {
    return ask(`**${st.name}** is not on shift on ${dayLabel(day)} anyway — they work ${st.days.map((d) => DOW_LONG[d].slice(0, 3)).join(', ')}${isOpenDay(state, day) ? '' : ', and the desk is closed that day'}. Nothing to hold back.`);
  }
  const win = matchWindow(state, q, staffId, day, deskNowMin(state.settings));
  if (!win) {
    return ask(`I have **${st.name}** on ${relativeDay(day)}, but not which part of the day. Say \`morning\`, \`afternoon\`, \`all day\`, or a range like \`from 2 to 5\`.`);
  }

  const s = toMin(win.start);
  const e = toMin(win.end);
  const clash = state.bookings.filter((b) => b.staffId === staffId && b.date === day
    && OPEN_STATUSES.includes(b.status)
    && toMin(b.time) < e && toMin(b.time) + b.blockMin > s)
    .sort((a, b) => a.time.localeCompare(b.time));

  if (clash.length) {
    return {
      text: `**${st.name}** has ${clash.length} booking${clash.length === 1 ? '' : 's'} inside ${win.label} on ${relativeDay(day)}, so I will not block over ${clash.length === 1 ? 'it' : 'them'} without being told to.`,
      table: {
        head: ['Token', 'Time', 'Customer'],
        rows: clash.map((b) => [tokenLabel(state, b), hm12(b.time), custOf(state, b.customerId).name]),
      },
      meta: 'nothing written yet',
      actions: [
        { label: 'Block the free time only', doingLabel: 'Holding…', run: () => runBlock(ctx, { staffId, day, start: win.start, end: win.end, label: win.label, around: clash.map((b) => b.id) }) },
        { label: `Cancel ${clash.length === 1 ? 'it' : `all ${clash.length}`} and block it all`, doingLabel: 'Holding…', run: () => runBlock(ctx, { staffId, day, start: win.start, end: win.end, label: win.label, cancel: clash.map((b) => b.id) }) },
      ],
    };
  }

  return {
    text: `${win.label.replace(/^t/, 'T')} is clear for **${st.name}** on ${relativeDay(day)}, so I can hold it back with nothing to move.`,
    table: understood([
      ['Staff', `${st.name} · ${st.role}`],
      ['Day', `${relativeDay(day)} · ${dayLabel(day)}`],
      ['Window', `${hm12(win.start)} to ${hm12(win.end)} · ${e - s} minutes`],
      ['Bookings hit', 'none'],
      ['Effect', 'those slots stop showing as bookable on the calendar'],
    ]),
    meta: 'nothing written yet',
    actions: [{
      label: `Block ${hm12(win.start)}–${hm12(win.end)}`,
      doingLabel: 'Holding…',
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
        logEvent(b, `Cancelled to hold ${o.label} for ${st.name}`);
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
      addBlock(s, { staffId: o.staffId, date: o.day, start: toHM(ps), end: toHM(pe), reason: `Held back — ${o.label}` });
    }
  });

  const held = blocksOn(ctx.state, o.staffId, o.day);
  const mins = held.reduce((n, x) => n + (toMin(x.end) - toMin(x.start)), 0);
  return {
    text: `Held. **${st.name}** is off the grid for ${held.map((x) => `${hm12(x.start)}–${hm12(x.end)}`).join(', ')} on ${dayLabel(o.day)}.`
      + (cancelled.length ? `\n\nCancelled to make room: ${cancelled.join(', ')}.` : ''),
    table: {
      head: ['', 'Before', 'After'],
      rows: [
        [`Bookable ${svcOf(ctx.state, skill).code} slots`, String(before), String(openCount(ctx.state, o.day, skill, o.staffId))],
        ['Time held back', '0 min', `${mins} min`],
        ['Bookings cancelled', '0', String(cancelled.length)],
      ],
    },
    meta: 'the calendar shows the held slots as unavailable',
    suggestions: ['Free slots tomorrow', 'Staff workload', 'What can you do?'],
  };
}

/* ============================================================
   6. Change a service duration or price
   ============================================================ */
function proposeService(ctx, q) {
  const state = ctx.state;
  const serviceId = matchService(state, q);
  if (!serviceId) return ask(`Which service? ${state.services.map((s) => s.name).join(', ')}. For example: \`make the dental cleaning 30 minutes\`.`);
  const svc = svcOf(state, serviceId);
  const text = String(q).toLowerCase();

  const wantsPrice = /\bprice|\bcost|\bcharge|\bfee|₹|\brs\b|\brupees?\b/.test(text);
  const wantsMinutes = /\bminute|\bmins?\b|\bduration|\blong\b|\bblock\b|\bbuffer\b/.test(text);
  const wantsBuffer = /\bbuffer\b/.test(text);

  let field = wantsPrice && !wantsMinutes ? 'price' : wantsMinutes ? (wantsBuffer ? 'buffer' : 'duration') : null;
  if (!field) return ask(`I can change a service's duration, its buffer or its price. Say which — \`set the physiotherapy price to 1200\` or \`make the dental cleaning 30 minutes\`.`);

  let value = field === 'price'
    ? (matchNumber(q, '\\bto\\b') ?? matchNumber(q, '\\b(?:price|cost|charge|fee|rs|rupees)\\b|₹') ?? matchNumber(q))
    : (matchNumber(q, '\\b(?:to|at)\\b') ?? matchNumber(q));
  if (field !== 'price') {
    const m = text.match(/(\d{1,3})\s*(?:min|mins|minutes)/);
    if (m) value = Number(m[1]);
  }
  if (!value || value <= 0) return ask(`I have **${svc.name}** and that you want the ${field} changed, but no number in the sentence. Add one — \`${field === 'price' ? `set ${svc.name.toLowerCase()} price to 1200` : `make ${svc.name.toLowerCase()} 30 minutes`}\`.`);
  if (field !== 'price' && value > 240) return ask(`${value} minutes is longer than any shift on the rota. Give me something under 240.`);
  if (field === 'price' && value > 100000) return ask(`${state.settings.currency}${value} looks like a typo rather than a price. Give me a figure under 100,000.`);

  const before = { duration: svc.durationMin, buffer: svc.bufferMin, price: svc.priceInr };
  const after = { ...before, [field]: value };
  if (before[field] === value) return ask(`**${svc.name}** is already at ${field === 'price' ? `${state.settings.currency}${value}` : `${value} minutes`}. Nothing to change.`);

  const newBlock = after.duration + after.buffer;
  const future = state.bookings.filter((b) => b.serviceId === serviceId && OPEN_STATUSES.includes(b.status) && b.date >= todayKey());

  return {
    text: `Changing the ${field} of **${svc.name}**.`
      + (field === 'price'
        ? `\n\nExisting bookings are priced from the service, so the ${future.length} still on the book will bill at the new figure.`
        : `\n\nThe booked block goes from ${before.duration + before.buffer} to ${newBlock} minutes. I will retime the ${future.length} future booking${future.length === 1 ? '' : 's'} that still fit, and leave any that would collide on the old block.`),
    table: understood([
      ['Service', `${svc.name} · ${svc.code}`],
      ['Field', field === 'price' ? 'Price' : field === 'buffer' ? 'Buffer' : 'Duration'],
      ['Before', field === 'price' ? `${state.settings.currency}${before.price}` : `${before[field]} min`],
      ['After', field === 'price' ? `${state.settings.currency}${value}` : `${value} min`],
      ['Bookings affected', String(future.length)],
    ]),
    meta: 'nothing written yet',
    actions: [{
      label: `Set ${field} to ${field === 'price' ? `${state.settings.currency}${value}` : `${value} min`}`,
      doingLabel: 'Saving…',
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
        if (fits) { retimed += 1; logEvent(b, `Block changed to ${block} minutes with the service`); }
        else { b.blockMin = old; left += 1; }
      }
    }
  });
  const svc = svcOf(ctx.state, serviceId);
  return {
    text: `Saved. **${svc.name}** is now ${svc.durationMin} minutes plus ${svc.bufferMin} minutes buffer at ${ctx.state.settings.currency}${svc.priceInr}.`
      + (field === 'price' ? '' : `\n\n${retimed} future booking${retimed === 1 ? '' : 's'} moved onto the new block${left ? `, ${left} left on the old one because the longer block would have run into the next appointment` : ''}.`),
    table: {
      head: ['', 'Before', 'After'],
      rows: [
        ['Duration', `${before.duration} min`, `${svc.durationMin} min`],
        ['Buffer', `${before.buffer} min`, `${svc.bufferMin} min`],
        ['Price', `${ctx.state.settings.currency}${before.price}`, `${ctx.state.settings.currency}${svc.priceInr}`],
      ],
    },
    meta: 'Services, the calendar and the booking dialog all read the new figure',
    suggestions: ['Which service earns most', 'Free slots tomorrow', 'What can you do?'],
  };
}

/* ============================================================
   what the agent can do — used by the intent and by the About modal
   ============================================================ */
export const ACTION_EXAMPLES = [
  {
    title: 'Book an appointment',
    input: 'book Anwar for physiotherapy tomorrow at 4',
    output: 'Names the customer, service, staff member and the exact slot, then books it on confirmation and hands back the token popup. If 4pm is gone it offers the nearest free slot instead.',
  },
  {
    title: 'Reschedule a booking',
    input: 'move SL-1042 to Thursday at 11',
    output: 'Finds the record by reference, token or customer name, checks the new slot holds the whole block, and reports the old time against the new one.',
  },
  {
    title: 'Cancel with a reason',
    input: 'cancel SL-1043 because the customer is unwell',
    output: 'Puts the reason on the record and in its history, and releases the minutes back onto the grid. With no reason in the sentence it asks for one first.',
  },
  {
    title: 'Run the queue',
    input: 'call the next token',
    output: 'Also "mark the current one served" and "A012 did not turn up". Names the token and customer before it changes anything, then shows how many are still waiting.',
  },
  {
    title: 'Hold back staff time',
    input: "block Nithya's afternoon tomorrow",
    output: 'Clamps the window to that person\'s shift. If bookings sit inside it, it refuses to write over them and offers to block only the free part.',
  },
  {
    title: 'Change a service',
    input: 'make the dental cleaning 30 minutes',
    output: 'Also "set the physiotherapy price to 1200". Retimes the future bookings that still fit the new block and says which were left on the old one.',
  },
];

function helpAnswer(state) {
  return {
    text: 'Six things I can change for you, on top of answering questions. I always show what I understood first and write nothing until you press the button.',
    table: {
      head: ['Ask me', 'What happens'],
      rows: ACTION_EXAMPLES.map((e) => [`**${e.title}**\n\`${e.input}\``, e.output]),
    },
    meta: `${state.bookings.length} bookings, ${state.services.length} services and ${state.staff.length} staff in reach`,
    suggestions: ACTION_CHIPS,
  };
}

/* ---------- the intents ---------- */
export function actionIntents(ctx) {
  return [
    {
      id: 'act-book',
      match: [/\b(?:book|schedule|register)\b(?!\w)|\bmake an appointment\b|\badd (?:a |an )?(?:booking|appointment)\b|\bput .* (?:in|down) for\b/i, 'book ', 'schedule '],
      trace: 'read the sentence against the rota and the grid',
      answer: (q) => proposeBook(ctx, q),
    },
    {
      id: 'act-move',
      match: [/\b(?:reschedule|rebook|move|push|shift|bring forward)\b/i, 'reschedule', 'move '],
      trace: 'matched the record, then walked the grid for the new slot',
      answer: (q) => proposeMove(ctx, q),
    },
    {
      id: 'act-cancel',
      match: [/\bcancel\b|\bcall(?:ed)? off\b|\bdrop\b|\bscrap\b/i, 'cancel '],
      trace: 'matched the record and read the reason out of the sentence',
      answer: (q) => proposeCancel(ctx, q),
    },
    {
      id: 'act-queue',
      match: [/\bcall (?:the )?next\b|\bnext token\b|\bmark\b.*\b(?:served|done|no.?show|serving)\b|\bseat\b|\bfinish(?:ed)?\b.*\b(?:token|current)\b|\b(?:did ?n.?t|did not|never) turn(?:ed)? up\b/i,
        'call next', 'call the next', 'turn up'],
      trace: 'read the live queue in slot order',
      answer: (q) => proposeQueue(ctx, q),
    },
    {
      id: 'act-block',
      match: [/\bblock\b|\bhold back\b|\bkeep .* free\b|\bmark .* (?:unavailable|off)\b|\btake .* off the grid\b/i, 'block '],
      trace: 'clamped the window to the shift and checked it against the diary',
      answer: (q) => proposeBlock(ctx, q),
    },
    {
      id: 'act-service',
      match: [/\b(?:change|set|make|update|raise|drop|reduce|increase)\b[^?]*\b(?:price|cost|charge|fee|duration|minutes?|mins?|buffer)\b/i, 'price to', 'minutes'],
      trace: 'read the service record and every future booking against it',
      answer: (q) => proposeService(ctx, q),
    },
    {
      id: 'act-help',
      match: [/what can you do|what are you able|help me|\bcommands?\b|what can i ask|things you can do|can you (?:change|do)/i, 'what can you do'],
      trace: 'listed the action intents in this build',
      answer: (q, state) => helpAnswer(state),
    },
  ];
}

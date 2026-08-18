/* ============================================================
   slotly — plain-language parsing for the desk agent.
   The sentences it reads are English: this is a matcher over English verbs,
   English weekday names and the canonical English service names the seed
   writes into the store, so it deliberately never looks at the dictionary.
   Turns a typed sentence into the records it names: a day, a time,
   a service, a staff member, a customer, a booking, a window of the
   day. Nothing here mutates; it only reads the live state so the
   agent can show what it understood before it changes anything.
   ============================================================ */

import {
  todayKey, addDays, parseDay, toMin, toHM, gridSlots, staffOf,
  OPEN_STATUSES, DOW_LONG_EN,
} from './data.js';
import { t } from './main.js';

/* ---------- day ---------- */
export function matchDay(q) {
  const text = String(q).toLowerCase();
  const tk = todayKey();
  if (/\btoday\b|\btonight\b/.test(text)) return tk;
  if (/day after tomorrow/.test(text)) return addDays(tk, 2);
  if (/\btomorrow\b|\btmrw\b/.test(text)) return addDays(tk, 1);
  if (/\byesterday\b/.test(text)) return addDays(tk, -1);
  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  for (let i = 0; i < 7; i += 1) {
    if (new RegExp(`\\b${DOW_LONG_EN[i].toLowerCase()}\\b`).test(text)) {
      const ahead = /\bnext\b/.test(text) ? 7 : 0;
      for (let d = 0; d < 8; d += 1) {
        const key = addDays(tk, d + ahead);
        if (parseDay(key).getDay() === i) return key;
      }
    }
  }
  return null;
}

/* ---------- service ---------- */
export function matchService(state, q) {
  const text = String(q).toLowerCase();
  const hints = [
    [/\bdental clean|\bcleaning\b|\bscaling\b|\bscale and polish\b/, 'svc-clean'],
    [/\bdental\b|\btooth\b|\bteeth\b/, 'svc-dental'],
    [/\bphysio\w*\b|\bback pain\b|\bknee\b/, 'svc-physio'],
    [/\bdiet\b|\bnutrition\b/, 'svc-diet'],
    [/\blab\b|\bblood\b|\bsample\b/, 'svc-lab'],
    [/\bvitals?\b|\bbmi\b/, 'svc-scan'],
    [/\bconsult\w*\b|\bgp\b|\bdoctor\b|\bcheck ?up\b/, 'svc-consult'],
  ];
  for (const s of state.services) {
    if (text.includes(s.name.toLowerCase())) return s.id;
    if (new RegExp(`\\b${s.code.toLowerCase()}\\b`).test(text)) return s.id;
  }
  for (const [re, id] of hints) {
    if (re.test(text) && state.services.some((s) => s.id === id)) return id;
  }
  return null;
}

/* ---------- staff ---------- */
export function matchStaff(state, q) {
  const text = String(q).toLowerCase();
  for (const st of state.staff) {
    const first = st.name.split(' ')[0].toLowerCase();
    if (text.includes(st.name.toLowerCase()) || new RegExp(`\\b${first}\\b`).test(text)) return st.id;
  }
  return null;
}

/** Only the staff member named after "with" — so "book Anwar for physio" does
    not read the customer's surname as the person taking the appointment. */
export function withStaff(state, q) {
  const m = String(q).match(/\bwith\s+([A-Za-z .'-]{2,40})/i);
  return m ? matchStaff(state, m[1]) : null;
}

/* ---------- customer ---------- */
export function matchCustomer(state, q) {
  const text = String(q).toLowerCase();
  let best = null;
  for (const c of state.customers) {
    const parts = c.name.split(' ');
    const first = parts[0].toLowerCase();
    const last = parts[1] ? parts[1].toLowerCase() : '';
    if (text.includes(c.name.toLowerCase())) return c;
    if (new RegExp(`\\b${first}\\b`).test(text) && !best) best = c;
    if (last && new RegExp(`\\b${last}\\b`).test(text) && !best) best = c;
  }
  return best;
}

const STOP = 'for|with|on|at|to|about|because|tomorrow|today|tonight|next|this|monday|tuesday|wednesday|thursday|friday|saturday|sunday';

/* Words that stand in for a person without naming one. Booking against these
   would put "Someone" on the customer list, so they are treated as no name. */
const NON_NAME = /^(?:someone|somebody|anyone|anybody|a person|person|the customer|a customer|customer|a client|client|the client|walk ?-?in|a walk ?-?in|me|him|her|them|us|they|people|a patient|the patient|patient|a guest|the guest|guest|new customer|a new customer|it|this|that)$/i;

/**
 * Who the appointment is for. Reads the phrase after the verb first and the
 * phrase after "for" second, so both "book Meera for a dental check-up" and
 * "book a dental check-up for Meera" land on the same customer.
 */
export function bookingCustomer(state, q) {
  const text = String(q);
  const phrases = [];
  const after = text.match(new RegExp(`\\b(?:book|schedule|add|put|register|slot)\\s+(?:in\\s+)?(?:an?\\s+|the\\s+)?(.+?)(?=\\s+(?:${STOP})\\b|[,.;]|$)`, 'i'));
  if (after) phrases.push(after[1]);
  const forPart = text.match(new RegExp(`\\bfor\\s+(?:an?\\s+|the\\s+)?(.+?)(?=\\s+(?:${STOP})\\b|[,.;]|$)`, 'i'));
  if (forPart) phrases.push(forPart[1]);

  for (const p of phrases) {
    if (NON_NAME.test(p.trim())) continue;
    const c = matchCustomer(state, p);
    if (c) return { customer: c, phrase: p.trim(), isNew: false };
  }
  for (const p of phrases) {
    const cand = p.trim().replace(/\s+/g, ' ');
    if (!cand || cand.length < 2 || NON_NAME.test(cand)) continue;
    if (matchService(state, cand) || matchStaff(state, cand)) continue;
    if (!/^[A-Za-z][A-Za-z .'-]{1,40}$/.test(cand)) continue;
    return { customer: null, phrase: cand.replace(/\b[a-z]/g, (ch) => ch.toUpperCase()), isNew: true };
  }
  return { customer: null, phrase: '', isNew: false };
}

/* ---------- time ---------- */
/** "at 4", "4pm", "16:00", "half four" is not supported — 24h or am/pm only. */
export function matchTime(state, q) {
  const text = String(q).toLowerCase().replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ');
  let hour = null;
  let min = 0;
  let ap = null;
  let m = text.match(/\b(\d{1,2})[:.](\d{2})\s*(am|pm)?/);
  if (m) { hour = Number(m[1]); min = Number(m[2]); ap = m[3] || null; }
  if (hour === null) {
    m = text.match(/\b(\d{1,2})\s*(am|pm)\b/) || text.match(/\bat\s+(\d{1,2})\b()/);
    if (m) { hour = Number(m[1]); min = 0; ap = m[2] || null; }
  }
  if (hour === null || hour > 24 || min > 59) return null;
  if (ap === 'pm' && hour < 12) hour += 12;
  if (ap === 'am' && hour === 12) hour = 0;
  let total = hour * 60 + min;
  /* "at 4" on a desk that opens at 08:30 means the afternoon. Only shift it
     when the morning reading falls outside opening hours and the afternoon
     one falls inside. */
  if (!ap && total < toMin(state.settings.openTime) && total + 720 < toMin(state.settings.closeTime)) total += 720;
  return toHM(total);
}

/** Nearest slot on the booking grid, so an odd minute still lands somewhere real. */
export function snapToGrid(state, hm) {
  const grid = gridSlots(state);
  if (!grid.length) return null;
  const want = toMin(hm);
  return grid.slice().sort((a, b) => Math.abs(toMin(a) - want) - Math.abs(toMin(b) - want))[0];
}

/* ---------- an existing booking ---------- */
/**
 * Which record the sentence is about. A reference wins, then a token, then the
 * open bookings of a named customer — which may be more than one, and the
 * caller is expected to ask rather than guess.
 */
export function matchBooking(state, q) {
  const text = String(q);
  const ref = text.match(/\bSL[-\s]?(\d{3,6})\b/i);
  if (ref) {
    const want = `sl-${ref[1]}`;
    const hit = state.bookings.find((b) => String(b.ref).toLowerCase() === want);
    return { booking: hit || null, list: hit ? [hit] : [], how: 'reference', label: `SL-${ref[1]}` };
  }
  const prefix = (state.settings.tokenPrefix || 'A');
  const tok = text.match(new RegExp(`\\b${prefix}\\s?(\\d{1,3})\\b`, 'i'));
  if (tok) {
    const n = Number(tok[1]);
    const tk = todayKey();
    const hits = state.bookings.filter((b) => b.date === tk && b.token === n && b.status !== 'cancelled');
    return { booking: hits[0] || null, list: hits, how: 'token', label: `${prefix}${String(n).padStart(3, '0')}` };
  }
  const c = matchCustomer(state, text);
  if (c) {
    const day = matchDay(text);
    let list = state.bookings
      .filter((b) => b.customerId === c.id && OPEN_STATUSES.includes(b.status) && b.date >= todayKey())
      .sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : a.date.localeCompare(b.date)));
    if (day && list.some((b) => b.date === day)) list = list.filter((b) => b.date === day);
    return { booking: list.length === 1 ? list[0] : null, list, how: 'customer', label: c.name, customer: c };
  }
  return { booking: null, list: [], how: null, label: '' };
}

/* ---------- a window of one working day ---------- */
/**
 * "afternoon", "morning", "all day", "from 2 to 5", "the rest of the day".
 * Clamped to the staff member's own shift so a block never claims time they
 * were never on for.
 */
export function matchWindow(state, q, staffId, key, nowMin) {
  const st = staffOf(state, staffId);
  const text = String(q).toLowerCase();
  const shiftS = toMin(st.start);
  const shiftE = toMin(st.end);
  const clamp = (v) => Math.min(shiftE, Math.max(shiftS, v));
  const out = (s, e, label) => (e > s ? { start: toHM(s), end: toHM(e), label } : null);

  const range = text.match(/\b(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|until|till|–|-)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/);
  if (range) {
    const a = matchTime(state, `at ${range[1]}`);
    const b = matchTime(state, `at ${range[2]}`);
    if (a && b) return out(clamp(toMin(a)), clamp(toMin(b)), t('act.block.windows.range', { from: a, to: b }));
  }
  if (/\bafternoon\b/.test(text)) return out(clamp(Math.max(shiftS, 13 * 60)), shiftE, t('act.block.windows.afternoon'));
  if (/\bmorning\b/.test(text)) return out(shiftS, clamp(Math.min(shiftE, 13 * 60)), t('act.block.windows.morning'));
  if (/\brest of (?:the )?day\b|\bremainder of (?:the )?day\b/.test(text)) {
    return out(clamp(Math.max(shiftS, nowMin || shiftS)), shiftE, t('act.block.windows.rest'));
  }
  if (/\ball day\b|\bwhole day\b|\bentire day\b|\bfull day\b|\bday off\b/.test(text)) return out(shiftS, shiftE, t('act.block.windows.whole'));
  return null;
}

/* ---------- numbers ---------- */
/** `prefix` is a raw pattern and must carry its own word boundaries. */
export function matchNumber(q, prefix) {
  const re = prefix
    ? new RegExp(`(?:${prefix})[^\\d]{0,12}(\\d{1,6})`, 'i')
    : /\b(\d{1,6})\b/;
  const m = String(q).match(re);
  return m ? Number(m[1]) : null;
}

export { toMin, toHM };

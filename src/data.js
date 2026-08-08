/* ============================================================
   slotly — demo dataset + scheduling maths.
   Everything here is invented sample data generated from a fixed
   seed, so the numbers are the same on every reload until the user
   changes something. No network, no external source.
   ============================================================ */

import { seeded, pick, between } from '../lib/ui.js';

export const STORE_KEY = 'slotly.v1';

/* ---------- time helpers (local time, never UTC) ---------- */
export const toMin = (hm) => {
  const [h, m] = String(hm).split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
export const toHM = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
export const hm12 = (hm) => {
  const t = toMin(hm);
  const h = Math.floor(t / 60);
  const suffix = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(t % 60).padStart(2, '0')} ${suffix}`;
};
/** Local calendar day key — deliberately not toISOString(), which shifts by timezone. */
export const dayKey = (d) => {
  const dt = d instanceof Date ? d : new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
};
export const parseDay = (key) => {
  const [y, m, d] = String(key).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
};
export const todayKey = () => dayKey(new Date());
/**
 * The desk clock. Real wall-clock minutes, clamped into opening hours so the
 * queue and the calendar still have something live in them when the app is
 * opened at midnight. Used for "is this slot in the past", never for dates.
 */
export function deskNowMin(settings) {
  const now = new Date();
  const real = now.getHours() * 60 + now.getMinutes();
  const lo = toMin(settings.openTime) + 60;
  const hi = Math.max(lo, toMin(settings.closeTime) - 180);
  return Math.min(Math.max(real, lo), hi);
}
export const addDays = (key, n) => {
  const d = parseDay(key);
  d.setDate(d.getDate() + n);
  return dayKey(d);
};
/** Monday-first start of the week containing `key`. */
export const weekStart = (key) => {
  const d = parseDay(key);
  const shift = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - shift);
  return dayKey(d);
};
export const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DOW_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const dayLabel = (key) => {
  const d = parseDay(key);
  return `${DOW[d.getDay()]} ${String(d.getDate()).padStart(2, '0')} ${d.toLocaleDateString('en-GB', { month: 'short' })}`;
};
export const relativeDay = (key) => {
  const t = todayKey();
  if (key === t) return 'Today';
  if (key === addDays(t, 1)) return 'Tomorrow';
  if (key === addDays(t, -1)) return 'Yesterday';
  return dayLabel(key);
};

/* ---------- vocabulary ---------- */
export const STATUS = {
  booked: { label: 'Booked', pill: 'pill--info' },
  called: { label: 'Called', pill: 'pill--amber' },
  serving: { label: 'Serving', pill: 'pill--warn' },
  done: { label: 'Done', pill: 'pill--ok' },
  'no-show': { label: 'No-show', pill: 'pill--bad' },
  cancelled: { label: 'Cancelled', pill: '' },
};
export const OPEN_STATUSES = ['booked', 'called', 'serving'];
export const ACTIVE_STATUSES = ['booked', 'called', 'serving', 'done'];
export const CHANNELS = ['Walk-in', 'Phone', 'Website', 'Front desk'];

const FIRST = [
  'Rehan', 'Anjali', 'Faizal', 'Meera', 'Sajid', 'Devika', 'Nithin', 'Ayesha',
  'Vishnu', 'Fathima', 'Rahul', 'Sneha', 'Basheer', 'Lakshmi', 'Irfan', 'Priya',
  'Noufal', 'Divya', 'Salman', 'Reshma', 'Hameed', 'Kavya', 'Yousuf', 'Deepa',
];
const LAST = [
  'Kurian', 'Menon', 'Rahman', 'Nair', 'Ali', 'Pillai', 'Thomas', 'Siddiqui',
  'Varghese', 'Basheer', 'Krishnan', 'Joseph', 'Hussain', 'Iyer', 'Latheef', 'Mathew',
  'Anwar', 'Raghavan', 'Farooq', 'Suresh', 'Abdulla', 'Balan', 'Zubair', 'Chandran',
];

/* ---------- seed ---------- */
export function seedState() {
  const rnd = seeded(20260808);

  const settings = {
    deskName: 'Ashwini Care Studio',
    branch: 'Kozhikode front desk',
    openTime: '08:30',
    closeTime: '18:00',
    slotMinutes: 30,
    closedDays: [0],
    maxPerSlot: 3,
    tokenPrefix: 'A',
    currency: '₹',
    confirmTemplate:
      'Hello {{name}}, your {{service}} at {{desk}} is confirmed for {{date}} at {{time}} with {{staff}}. Token {{token}}. Reply CANCEL to release the slot.',
    reminderTemplate:
      'Reminder: {{name}}, you have {{service}} tomorrow at {{time}}. Please arrive 10 minutes early and carry your token {{token}}.',
    cancelTemplate:
      '{{name}}, your booking on {{date}} at {{time}} has been cancelled. Call the desk to pick another slot.',
  };

  const services = [
    { id: 'svc-consult', name: 'General consultation', code: 'GEN', durationMin: 15, bufferMin: 15, priceInr: 400, active: true },
    { id: 'svc-dental', name: 'Dental check-up', code: 'DEN', durationMin: 20, bufferMin: 10, priceInr: 600, active: true },
    { id: 'svc-clean', name: 'Dental cleaning', code: 'CLN', durationMin: 40, bufferMin: 20, priceInr: 1800, active: true },
    { id: 'svc-physio', name: 'Physiotherapy session', code: 'PHY', durationMin: 45, bufferMin: 15, priceInr: 900, active: true },
    { id: 'svc-diet', name: 'Diet review', code: 'DIT', durationMin: 25, bufferMin: 5, priceInr: 700, active: true },
    { id: 'svc-lab', name: 'Lab sample collection', code: 'LAB', durationMin: 10, bufferMin: 5, priceInr: 250, active: true },
    { id: 'svc-scan', name: 'Vitals and BMI scan', code: 'VIT', durationMin: 15, bufferMin: 0, priceInr: 300, active: false },
  ];

  const staff = [
    {
      id: 'st-rehana', name: 'Rehana Mansoor', initials: 'RM', role: 'General physician',
      days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00', breakStart: '13:00', breakEnd: '14:00',
      skills: ['svc-consult', 'svc-diet', 'svc-lab'], active: true, room: 'Room 1',
    },
    {
      id: 'st-anwar', name: 'Anwar Sheikh', initials: 'AS', role: 'Dental surgeon',
      days: [1, 2, 3, 4, 6], start: '10:00', end: '18:00', breakStart: '13:30', breakEnd: '14:30',
      skills: ['svc-dental', 'svc-clean', 'svc-consult'], active: true, room: 'Room 2',
    },
    {
      id: 'st-nithya', name: 'Nithya Balan', initials: 'NB', role: 'Physiotherapist',
      days: [1, 2, 3, 4, 5], start: '08:30', end: '16:30', breakStart: '12:30', breakEnd: '13:00',
      skills: ['svc-physio', 'svc-consult', 'svc-lab'], active: true, room: 'Bay 3',
    },
  ];

  const customers = FIRST.map((first, i) => {
    const last = LAST[(i * 5 + 3) % LAST.length];
    const name = `${first} ${last}`;
    const tail = 1000 + between(100, 899, rnd);
    return {
      id: `cus-${i + 1}`,
      name,
      phone: `+91 ••••• ${tail}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      since: dayKey(new Date(2025, between(0, 11, rnd), between(1, 28, rnd))),
      tags: rnd() < 0.22 ? ['Priority'] : [],
      note: '',
    };
  });

  const bookings = [];
  let refSeq = 1040;
  const t0 = todayKey();

  for (let d = -14; d <= 14; d += 1) {
    const key = addDays(t0, d);
    const dow = parseDay(key).getDay();
    if (settings.closedDays.includes(dow)) continue;

    for (const st of staff) {
      if (!st.days.includes(dow)) continue;
      const bStart = toMin(st.breakStart);
      const bEnd = toMin(st.breakEnd);
      const end = toMin(st.end);
      let m = toMin(st.start);

      while (m < end) {
        if (m >= bStart && m < bEnd) { m = bEnd; continue; }
        const fill = d < 0 ? 0.62 : d === 0 ? 0.66 : d <= 3 ? 0.52 : 0.3;
        if (rnd() >= fill) { m += settings.slotMinutes; continue; }

        const eligible = services.filter((s) => s.active && st.skills.includes(s.id));
        const svc = pick(eligible, rnd);
        const block = svc.durationMin + svc.bufferMin;
        const finish = m + block;
        if (finish > end || (m < bStart && finish > bStart)) { m += settings.slotMinutes; continue; }

        const cust = pick(customers, rnd);
        let status = 'booked';
        if (d < 0) {
          const r = rnd();
          status = r < 0.08 ? 'no-show' : r < 0.13 ? 'cancelled' : 'done';
        } else if (d === 0) {
          const nowMin = deskNowMin(settings);
          if (finish <= nowMin) status = rnd() < 0.1 ? 'no-show' : 'done';
          else if (m <= nowMin) status = 'serving';
          else if (m <= nowMin + settings.slotMinutes) status = 'called';
          else status = rnd() < 0.05 ? 'cancelled' : 'booked';
        } else {
          status = rnd() < 0.06 ? 'cancelled' : 'booked';
        }

        refSeq += 1;
        bookings.push({
          id: `bk-${refSeq}`,
          ref: `SL-${refSeq}`,
          date: key,
          time: toHM(m),
          blockMin: block,
          serviceId: svc.id,
          staffId: st.id,
          customerId: cust.id,
          status,
          token: 0,
          channel: pick(CHANNELS, rnd),
          note: '',
          createdAt: Date.now() - (14 - d) * 86400000 - between(1, 20, rnd) * 3600000,
          history: [],
        });

        m += Math.ceil(block / settings.slotMinutes) * settings.slotMinutes;
      }
    }
  }

  assignTokens(bookings);

  return {
    version: 1,
    settings,
    services,
    staff,
    customers,
    bookings,
    seededAt: Date.now(),
  };
}

/** Token numbers run per day, in slot order. */
export function assignTokens(bookings) {
  const byDay = {};
  for (const b of bookings) (byDay[b.date] = byDay[b.date] || []).push(b);
  for (const key of Object.keys(byDay)) {
    byDay[key]
      .slice()
      .sort((a, b) => (a.time === b.time ? a.id.localeCompare(b.id) : a.time.localeCompare(b.time)))
      .forEach((b, i) => { b.token = i + 1; });
  }
  return bookings;
}

export const tokenLabel = (state, b) =>
  `${(state.settings.tokenPrefix || 'A')}${String(b.token).padStart(3, '0')}`;

/* ---------- lookups ---------- */
export const svcOf = (state, id) => state.services.find((s) => s.id === id) || { name: 'Removed service', code: '—', durationMin: 0, bufferMin: 0, priceInr: 0 };
export const staffOf = (state, id) => state.staff.find((s) => s.id === id) || { name: 'Unassigned', initials: '—', role: '', room: '' };
export const custOf = (state, id) => state.customers.find((c) => c.id === id) || { name: 'Walk-in guest', phone: '—', email: '' };

export const bookingsOn = (state, key) =>
  state.bookings.filter((b) => b.date === key).sort((a, b) => a.time.localeCompare(b.time));

export const liveOn = (state, key) =>
  bookingsOn(state, key).filter((b) => b.status !== 'cancelled');

/* ---------- grid + availability ---------- */
export function gridSlots(state) {
  const { openTime, closeTime, slotMinutes } = state.settings;
  const out = [];
  for (let m = toMin(openTime); m + slotMinutes <= toMin(closeTime); m += slotMinutes) out.push(toHM(m));
  return out;
}

export const isOpenDay = (state, key) => !state.settings.closedDays.includes(parseDay(key).getDay());

export function staffWorks(state, staffId, key) {
  const st = staffOf(state, staffId);
  if (!st.active) return false;
  if (!isOpenDay(state, key)) return false;
  return (st.days || []).includes(parseDay(key).getDay());
}

/** Minutes a staff member is on shift for a day (break removed). */
export function shiftMinutes(state, staffId, key) {
  if (!staffWorks(state, staffId, key)) return 0;
  const st = staffOf(state, staffId);
  const brk = Math.max(0, toMin(st.breakEnd) - toMin(st.breakStart));
  return Math.max(0, toMin(st.end) - toMin(st.start) - brk);
}

/** True when [start,start+block) fits the shift, misses the break and hits no booking. */
export function staffFree(state, staffId, key, start, block, ignoreId) {
  if (!staffWorks(state, staffId, key)) return false;
  const st = staffOf(state, staffId);
  const s = toMin(start);
  const e = s + block;
  if (s < toMin(st.start) || e > toMin(st.end)) return false;
  const bs = toMin(st.breakStart);
  const be = toMin(st.breakEnd);
  if (s < be && e > bs) return false;
  return !state.bookings.some((b) => {
    if (b.staffId !== staffId || b.date !== key) return false;
    if (b.id === ignoreId) return false;
    if (b.status === 'cancelled' || b.status === 'no-show') return false;
    const os = toMin(b.time);
    return s < os + b.blockMin && e > os;
  });
}

/** Staff ids that can take `serviceId` at `start` on `key`. */
export function freeStaffAt(state, key, start, serviceId, ignoreId) {
  const svc = svcOf(state, serviceId);
  const block = svc.durationMin + svc.bufferMin;
  return state.staff
    .filter((st) => st.active && st.skills.includes(serviceId))
    .filter((st) => staffFree(state, st.id, key, start, block, ignoreId))
    .map((st) => st.id);
}

/** All open grid slots for a day and service: [{time, staffIds}] */
export function freeSlots(state, key, serviceId, staffId, ignoreId) {
  if (!isOpenDay(state, key)) return [];
  return gridSlots(state)
    .map((time) => {
      let ids = freeStaffAt(state, key, time, serviceId, ignoreId);
      if (staffId) ids = ids.filter((id) => id === staffId);
      return { time, staffIds: ids };
    })
    .filter((s) => s.staffIds.length);
}

/** Next bookable {date,time} from today onward, optionally pinned to a staff member. */
export function nextAvailable(state, serviceId, staffId, fromKey) {
  const start = fromKey || todayKey();
  const nowMin = deskNowMin(state.settings);
  for (let d = 0; d < 21; d += 1) {
    const key = addDays(start, d);
    for (const slot of freeSlots(state, key, serviceId, staffId)) {
      if (d === 0 && toMin(slot.time) <= nowMin) continue;
      return { date: key, time: slot.time, staffIds: slot.staffIds };
    }
  }
  return null;
}

/** Booked share of the day, per staff and overall. */
export function utilisation(state, key) {
  let capacity = 0;
  let used = 0;
  const perStaff = state.staff.map((st) => {
    const cap = shiftMinutes(state, st.id, key);
    const booked = state.bookings
      .filter((b) => b.date === key && b.staffId === st.id && b.status !== 'cancelled')
      .reduce((n, b) => n + b.blockMin, 0);
    capacity += cap;
    used += Math.min(booked, cap || booked);
    return { staffId: st.id, name: st.name, capacity: cap, booked, pct: cap ? Math.round((booked / cap) * 100) : 0 };
  });
  return { capacity, used, pct: capacity ? Math.round((used / capacity) * 100) : 0, perStaff };
}

/** Visit counts and no-show rate for a customer. */
export function customerStats(state, customerId) {
  const list = state.bookings.filter((b) => b.customerId === customerId);
  const attended = list.filter((b) => b.status === 'done').length;
  const noShows = list.filter((b) => b.status === 'no-show').length;
  const cancelled = list.filter((b) => b.status === 'cancelled').length;
  const upcoming = list.filter((b) => OPEN_STATUSES.includes(b.status) && b.date >= todayKey()).length;
  const settled = attended + noShows;
  const spend = list.filter((b) => b.status === 'done').reduce((n, b) => n + svcOf(state, b.serviceId).priceInr, 0);
  const last = list.filter((b) => b.status === 'done').map((b) => b.date).sort().pop() || null;
  return {
    total: list.length, attended, noShows, cancelled, upcoming, spend, last,
    rate: settled ? Math.round((noShows / settled) * 100) : 0,
  };
}

/** Bookings per opening hour across a date range, used for "busiest hour". */
export function hourLoad(state, fromKey, toKey) {
  const map = new Map();
  for (const b of state.bookings) {
    if (b.date < fromKey || b.date > toKey) continue;
    if (b.status === 'cancelled') continue;
    const hour = `${b.time.slice(0, 2)}:00`;
    map.set(hour, (map.get(hour) || 0) + 1);
  }
  return [...map.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour.localeCompare(b.hour));
}

/* ---------- mutations used by more than one view ---------- */
export function nextRef(state) {
  const max = state.bookings.reduce((n, b) => Math.max(n, Number(String(b.ref).split('-')[1]) || 0), 1040);
  return `SL-${max + 1}`;
}

export function logEvent(b, text) {
  b.history = b.history || [];
  b.history.unshift({ at: Date.now(), text });
  if (b.history.length > 12) b.history.length = 12;
  return b;
}

export function createBooking(state, { date, time, serviceId, staffId, customerId, channel, note }) {
  const svc = svcOf(state, serviceId);
  const ref = nextRef(state);
  const b = {
    id: `bk-${ref.split('-')[1]}-${Math.random().toString(36).slice(2, 6)}`,
    ref,
    date,
    time,
    blockMin: svc.durationMin + svc.bufferMin,
    serviceId,
    staffId,
    customerId,
    status: 'booked',
    token: 0,
    channel: channel || 'Front desk',
    note: note || '',
    createdAt: Date.now(),
    history: [{ at: Date.now(), text: 'Booked at the front desk' }],
  };
  state.bookings.push(b);
  assignTokens(state.bookings);
  return b;
}

/** Message template rendering — {{name}}, {{service}}, {{date}} … */
export function renderTemplate(tpl, vars) {
  return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] === undefined ? `{{${k}}}` : String(vars[k])));
}

export function templateVars(state, b) {
  if (!b) {
    return {
      name: 'Meera Nair', service: 'General consultation', desk: state.settings.deskName,
      date: dayLabel(todayKey()), time: hm12('10:30'), staff: 'Rehana Mansoor',
      token: `${state.settings.tokenPrefix}004`, price: `${state.settings.currency}400`, ref: 'SL-1041',
    };
  }
  return {
    name: custOf(state, b.customerId).name,
    service: svcOf(state, b.serviceId).name,
    desk: state.settings.deskName,
    date: dayLabel(b.date),
    time: hm12(b.time),
    staff: staffOf(state, b.staffId).name,
    token: tokenLabel(state, b),
    price: `${state.settings.currency}${svcOf(state, b.serviceId).priceInr}`,
    ref: b.ref,
  };
}

export const TEMPLATE_KEYS = ['name', 'service', 'staff', 'date', 'time', 'token', 'price', 'desk', 'ref'];

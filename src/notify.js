/* ============================================================
   slotly — desk notifications.
   Nothing is pushed and nothing is stored as a message: the list is
   derived from the live booking data every time it is opened, so it
   is always true. Only the read marks are persisted, under their own
   key so "Reset demo data" leaves them alone.
   ============================================================ */

import { h, icon } from '../lib/ui.js';
import { t } from './main.js';
import {
  todayKey, addDays, hm12, toMin, deskNowMin, relativeDay, dayLabel,
  svcOf, staffOf, custOf, tokenLabel, shiftMinutes, staffWorks, OPEN_STATUSES,
  svcName,
} from './data.js';

const NOTIFY_KEY = 'slotly.notify';

function loadRead() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFY_KEY));
    return new Set(Array.isArray(raw && raw.read) ? raw.read : []);
  } catch (_) { return new Set(); }
}
function saveRead(set) {
  try {
    localStorage.setItem(NOTIFY_KEY, JSON.stringify({ read: [...set].slice(-300) }));
  } catch (_) { /* private mode — the bell still works, it just forgets */ }
}

/**
 * Everything the desk would want shouted at it, newest concern first.
 * Each id encodes the record and the state it was in, so a booking that
 * moves or changes becomes a new, unread notification.
 */
export function buildNotifications(state) {
  const key = todayKey();
  const now = deskNowMin(state.settings);
  const out = [];

  /* 1. starting within the hour */
  for (const b of state.bookings) {
    if (b.date !== key) continue;
    if (b.status !== 'booked' && b.status !== 'called') continue;
    const m = toMin(b.time);
    if (m < now || m > now + 60) continue;
    out.push({
      id: `soon:${b.id}:${b.date}:${b.time}`,
      kind: 'soon',
      tone: 'info',
      sort: m,
      title: t('notify.soonTitle', { token: tokenLabel(state, b), time: hm12(b.time) }),
      text: t('notify.soonText', {
        name: custOf(state, b.customerId).name,
        service: svcName(svcOf(state, b.serviceId)),
        staff: staffOf(state, b.staffId).name,
        mins: Math.max(0, m - now),
      }),
      when: hm12(b.time),
    });
  }

  /* 2. staff running over — still at the chair past the end of the block */
  for (const b of state.bookings) {
    if (b.date !== key || b.status !== 'serving') continue;
    const over = now - (toMin(b.time) + b.blockMin);
    if (over <= 0) continue;
    out.push({
      id: `over:${b.id}:${Math.floor(over / 15)}`,
      kind: 'over',
      tone: 'warn',
      sort: -200 - over,
      title: t('notify.overTitle', { staff: staffOf(state, b.staffId).name }),
      text: t('notify.overText', {
        token: tokenLabel(state, b), name: custOf(state, b.customerId).name,
        time: hm12(b.time), block: b.blockMin, over,
      }),
      when: `+${over}m`,
    });
  }

  /* 3. today's no-shows */
  for (const b of state.bookings) {
    if (b.date !== key || b.status !== 'no-show') continue;
    out.push({
      id: `noshow:${b.id}`,
      kind: 'noshow',
      tone: 'bad',
      sort: -100 + toMin(b.time) / 1000,
      title: t('notify.noShowTitle', { token: tokenLabel(state, b) }),
      text: t('notify.noShowText', {
        name: custOf(state, b.customerId).name, time: hm12(b.time), block: b.blockMin,
      }),
      when: hm12(b.time),
    });
  }

  /* 4. cancellations still ahead of us */
  for (const b of state.bookings) {
    if (b.status !== 'cancelled' || b.date < key || b.date > addDays(key, 7)) continue;
    out.push({
      id: `cancel:${b.id}`,
      kind: 'cancel',
      tone: 'muted',
      sort: 100 + toMin(b.time) / 1000,
      title: t('notify.cancelTitle', { ref: b.ref }),
      text: t('notify.cancelText', {
        name: custOf(state, b.customerId).name, service: svcName(svcOf(state, b.serviceId)),
        day: relativeDay(b.date), time: hm12(b.time), note: b.note,
      }),
      when: relativeDay(b.date),
    });
  }

  /* 5. anyone booked past the minutes they are actually on for */
  for (const st of state.staff) {
    if (!staffWorks(state, st.id, key)) continue;
    const cap = shiftMinutes(state, st.id, key);
    const booked = state.bookings
      .filter((b) => b.date === key && b.staffId === st.id && b.status !== 'cancelled')
      .reduce((n, b) => n + b.blockMin, 0);
    if (!cap || booked <= cap) continue;
    out.push({
      id: `overbook:${st.id}:${key}:${booked}`,
      kind: 'over',
      tone: 'warn',
      sort: -150,
      title: t('notify.overbookTitle', { staff: st.name }),
      text: t('notify.overbookText', { booked, capacity: cap, day: dayLabel(key) }),
      when: t('notify.today'),
    });
  }

  return out.sort((a, b) => a.sort - b.sort).slice(0, 40);
}

/* ---------- the bell and its panel ---------- */
export function mountBell(ctx) {
  const read = loadRead();
  const count = h('span', { class: 'bellbtn__count mono', 'aria-hidden': 'true' }, '0');
  const btn = h('button', {
    class: 'btn btn--ghost btn--icon bellbtn',
    type: 'button',
    'aria-haspopup': 'dialog',
    'aria-expanded': 'false',
    html: icon('bell'),
  });
  btn.appendChild(count);

  const panel = h('div', { class: 'notepanel', role: 'dialog', 'aria-label': t('notify.label'), hidden: true });
  const wrap = h('div', { class: 'bellwrap' }, btn, panel);

  const unread = () => buildNotifications(ctx.state).filter((n) => !read.has(n.id));

  function paintCount() {
    const n = unread().length;
    count.textContent = n > 9 ? '9+' : String(n);
    count.hidden = n === 0;
    btn.classList.toggle('has-unread', n > 0);
    const label = n ? t('notify.unread', { n }) : t('notify.nothingNew');
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  function paintPanel() {
    const list = buildNotifications(ctx.state);
    panel.innerHTML = '';
    const allRead = h('button', { class: 'btn btn--sm', type: 'button' }, t('notify.markAll'));
    allRead.disabled = !list.some((n) => !read.has(n.id));
    /* Repainting removes the button that was clicked, so by the time the event
       reaches document the target is detached and the outside-click guard would
       read it as an outside click. Stop it here instead. */
    allRead.addEventListener('click', (e) => {
      e.stopPropagation();
      list.forEach((n) => read.add(n.id));
      saveRead(read);
      paintCount();
      paintPanel();
    });
    panel.appendChild(h('div', { class: 'notepanel__head' },
      h('h3', {}, t('notify.label')),
      allRead));

    if (!list.length) {
      panel.appendChild(h('div', { class: 'notepanel__empty' },
        h('div', { class: 'label' }, t('notify.allClear')),
        h('p', { class: 'small muted', style: 'margin-top:6px' }, t('notify.allClearBody'))));
      return;
    }

    const body = h('div', { class: 'notelist' });
    for (const n of list) {
      const isNew = !read.has(n.id);
      const row = h('button', {
        class: `noterow${isNew ? ' is-new' : ''}`,
        type: 'button',
        'aria-label': `${isNew ? t('notify.unreadPrefix') : ''}${n.title}. ${n.text}`,
      },
      h('span', { class: `noterow__dot noterow__dot--${n.tone}`, 'aria-hidden': 'true' }),
      h('span', { class: 'noterow__body' },
        h('span', { class: 'noterow__title' }, n.title),
        /* the dot is a colour; the word is what actually says "unread" */
        isNew ? h('span', { class: 'noterow__new' }, t('notify.new')) : null,
        h('span', { class: 'noterow__text' }, n.text)),
      h('span', { class: 'noterow__when mono' }, n.when));
      row.addEventListener('click', (e) => {
        e.stopPropagation();
        if (read.has(n.id)) read.delete(n.id); else read.add(n.id);
        saveRead(read);
        paintCount();
        paintPanel();
      });
      body.appendChild(row);
    }
    panel.appendChild(body);
    panel.appendChild(h('div', { class: 'notepanel__foot small faint' }, t('notify.foot')));
  }

  let open = false;
  const setOpen = (v) => {
    open = v;
    panel.hidden = !v;
    btn.setAttribute('aria-expanded', String(v));
    if (v) {
      paintPanel();
      const first = panel.querySelector('button');
      if (first) setTimeout(() => first.focus(), 20);
    }
  };

  btn.addEventListener('click', (e) => { e.stopPropagation(); setOpen(!open); });
  document.addEventListener('click', (e) => {
    if (!open) return;
    if (wrap.contains(e.target)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && open) { setOpen(false); btn.focus(); }
  });

  ctx.store.subscribe(() => { paintCount(); if (open) paintPanel(); });
  paintCount();
  return wrap;
}

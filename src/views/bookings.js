/* Bookings — every record, filterable, with reschedule and cancel. */

import { h, icon, downloadCSV, toast, ago } from '../../lib/ui.js';
import {
  todayKey, dayLabel, hm12, toMin, toHM, svcOf, staffOf, custOf, tokenLabel, STATUS,
  renderTemplate, templateVars, relativeDay,
} from '../data.js';
import { openBooking, openReschedule, cancelBooking } from '../booking.js';
import { drawer } from '../drawer.js';

const RANGES = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'past', label: 'Past' },
  { id: 'all', label: 'All' },
];

const state = { q: '', status: '', service: '', staff: '', range: 'upcoming' };

function detail(ctx, b) {
  const s = ctx.state;
  const svc = svcOf(s, b.serviceId);
  const st = staffOf(s, b.staffId);
  const cust = custOf(s, b.customerId);
  const noteIn = h('textarea', { class: 'textarea', style: 'min-height:70px' }, b.note || '');
  const saveNote = h('button', { class: 'btn btn--sm' }, 'Save note');
  saveNote.addEventListener('click', () => {
    ctx.store.update((draft) => {
      const rec = draft.bookings.find((x) => x.id === b.id);
      if (rec) rec.note = noteIn.value.trim();
    });
    toast('Note saved', 'ok');
  });

  const body = h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('span', { class: `pill ${(STATUS[b.status] || STATUS.booked).pill}` }, (STATUS[b.status] || STATUS.booked).label),
      h('span', { class: 'pill' }, b.channel)),
    h('dl', { class: 'kv' },
      h('dt', {}, 'Token'), h('dd', { class: 'mono' }, tokenLabel(s, b)),
      h('dt', {}, 'When'), h('dd', {}, `${dayLabel(b.date)} · ${hm12(b.time)} — ${hm12(toHM(toMin(b.time) + b.blockMin))}`),
      h('dt', {}, 'Service'), h('dd', {}, `${svc.name} · ${svc.durationMin} min + ${svc.bufferMin} min buffer`),
      h('dt', {}, 'Staff'), h('dd', {}, `${st.name} · ${st.role} · ${st.room}`),
      h('dt', {}, 'Customer'), h('dd', {}, `${cust.name} · ${cust.phone}`),
      h('dt', {}, 'Price'), h('dd', { class: 'mono' }, `${s.settings.currency}${svc.priceInr}`),
      h('dt', {}, 'Created'), h('dd', {}, ago(b.createdAt))),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:6px' }, 'Confirmation that went out'),
      h('div', { class: 'bubble' },
        h('div', { class: 'bubble__from' }, `To ${cust.phone}`),
        renderTemplate(s.settings.confirmTemplate, templateVars(s, b)))),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:6px' }, 'Desk note'),
      noteIn,
      h('div', { style: 'margin-top:8px' }, saveNote)),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:8px' }, 'History'),
      h('div', { class: 'hist' }, (b.history && b.history.length ? b.history : [{ at: b.createdAt, text: 'Booking created' }])
        .map((e) => h('div', { class: 'hist__i' },
          h('div', { class: 'hist__t' }, ago(e.at)),
          h('div', {}, e.text))))));

  drawer({
    title: `${b.ref} · ${cust.name}`,
    subtitle: `${relativeDay(b.date)} at ${hm12(b.time)}`,
    body,
    actions: [
      { label: 'Reschedule', onClick: () => { openReschedule(ctx, b); } },
      { label: 'Cancel booking', class: 'btn--danger', onClick: () => { cancelBooking(ctx, b); } },
    ],
  });
}

export default function renderBookings(ctx) {
  const s = ctx.state;
  const today = todayKey();
  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, 'Bookings'),
      h('p', {}, 'Every record the desk holds. Reschedule moves the slot and keeps the reference; cancelling releases the slot back to the calendar.')),
    h('div', { class: 'btnrow' },
      (() => {
        const b = h('button', { class: 'btn', html: `${icon('download')}<span>Export CSV</span>` });
        b.addEventListener('click', () => {
          const rows = [['Ref', 'Token', 'Date', 'Time', 'Customer', 'Service', 'Staff', 'Channel', 'Status', 'Price']];
          filtered().forEach((b2) => rows.push([
            b2.ref, tokenLabel(s, b2), b2.date, b2.time, custOf(s, b2.customerId).name,
            svcOf(s, b2.serviceId).name, staffOf(s, b2.staffId).name, b2.channel,
            (STATUS[b2.status] || {}).label || b2.status, svcOf(s, b2.serviceId).priceInr,
          ]));
          downloadCSV(`slotly-bookings-${today}.csv`, rows);
          toast(`${rows.length - 1} rows exported`, 'ok');
        });
        return b;
      })(),
      (() => {
        const b = h('button', { class: 'btn btn--primary', html: `${icon('plus')}<span>New booking</span>` });
        b.addEventListener('click', () => openBooking(ctx, {}));
        return b;
      })())));

  /* ---- toolbar ---- */
  const search = h('div', { class: 'search' },
    h('span', { html: icon('search') }),
    h('input', { class: 'input', placeholder: 'Search name, reference or token', value: state.q, 'aria-label': 'Search bookings' }));
  search.querySelector('input').addEventListener('input', (e) => {
    state.q = e.target.value;
    redraw();
  });

  const sel = (label, key, options) => {
    const el = h('select', { class: 'select', style: 'max-width:190px', 'aria-label': label },
      h('option', { value: '' }, label),
      options.map((o) => h('option', { value: o.id, selected: state[key] === o.id }, o.name)));
    el.addEventListener('change', () => { state[key] = el.value; redraw(); });
    return el;
  };

  const rangeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Date range' },
    RANGES.map((r) => {
      const b = h('button', { type: 'button', class: state.range === r.id ? 'is-on' : '', 'aria-pressed': String(state.range === r.id) }, r.label);
      b.addEventListener('click', () => { state.range = r.id; redraw(); });
      return b;
    }));

  wrap.appendChild(h('div', { class: 'toolbar' },
    rangeSeg,
    search,
    sel('Any status', 'status', Object.keys(STATUS).map((k) => ({ id: k, name: STATUS[k].label }))),
    sel('Any service', 'service', s.services.map((x) => ({ id: x.id, name: x.name }))),
    sel('Any staff', 'staff', s.staff.map((x) => ({ id: x.id, name: x.name })))));

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return s.bookings.filter((b) => {
      if (state.range === 'upcoming' && b.date < today) return false;
      if (state.range === 'past' && b.date >= today) return false;
      if (state.status && b.status !== state.status) return false;
      if (state.service && b.serviceId !== state.service) return false;
      if (state.staff && b.staffId !== state.staff) return false;
      if (q) {
        const hay = `${b.ref} ${tokenLabel(s, b)} ${custOf(s, b.customerId).name} ${svcOf(s, b.serviceId).name} ${staffOf(s, b.staffId).name}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => (a.date === b.date ? a.time.localeCompare(b.time) : (state.range === 'past' ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date))));
  }

  const host = h('div', {});
  wrap.appendChild(host);

  function redraw() {
    const rows = filtered();
    host.innerHTML = '';
    host.appendChild(h('p', { class: 'hint', style: 'margin:0 0 10px' },
      `${rows.length} booking${rows.length === 1 ? '' : 's'} · ${rows.filter((b) => b.status === 'booked').length} still open`));

    if (!rows.length) {
      host.appendChild(h('div', { class: 'empty' },
        h('h3', {}, 'No bookings match'),
        h('p', { class: 'small' }, 'Clear a filter or widen the range to All.')));
      return;
    }

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        ['Ref', 'Token', 'When', 'Customer', 'Service', 'Staff', 'Status', ''].map((c) => h('th', { class: c === '' ? 'right' : '' }, c)))),
      h('tbody', {}, rows.map((b) => {
        const st = STATUS[b.status] || STATUS.booked;
        const ref = h('span', { class: 'linkish', role: 'button', tabindex: '0' }, b.ref);
        const open = () => detail(ctx, b);
        ref.addEventListener('click', open);
        ref.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

        const move = h('button', { class: 'btn btn--sm', 'aria-label': `Reschedule ${b.ref}` }, 'Move');
        move.addEventListener('click', () => openReschedule(ctx, b));
        const cancel = h('button', { class: 'btn btn--sm btn--danger', 'aria-label': `Cancel ${b.ref}` }, 'Cancel');
        cancel.addEventListener('click', () => cancelBooking(ctx, b));
        const closed = b.status === 'cancelled' || b.status === 'done' || b.status === 'no-show';

        return h('tr', {},
          h('td', { class: 'mono' }, ref),
          h('td', { class: 'mono' }, tokenLabel(s, b)),
          h('td', {}, h('div', {}, relativeDay(b.date)), h('div', { class: 'mono small faint' }, hm12(b.time))),
          h('td', {}, custOf(s, b.customerId).name),
          h('td', {}, h('div', {}, svcOf(s, b.serviceId).name), h('div', { class: 'small faint mono' }, `${s.settings.currency}${svcOf(s, b.serviceId).priceInr}`)),
          h('td', {}, staffOf(s, b.staffId).name),
          h('td', {}, h('span', { class: `pill ${st.pill}` }, st.label)),
          h('td', { class: 'right' }, h('div', { class: 'btnrow', style: 'justify-content:flex-end' },
            closed ? null : move, closed ? null : cancel)));
      })));

    host.appendChild(h('div', { class: 'tablewrap tablewrap--scroll' }, table));
  }

  redraw();
  return wrap;
}

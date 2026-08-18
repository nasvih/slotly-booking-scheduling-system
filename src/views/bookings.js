/* Bookings — every record, filterable, with reschedule and cancel. */

import { h, icon, downloadCSV, toast, ago } from '../../lib/ui.js';
import {
  todayKey, dayLabel, hm12, toMin, toHM, svcOf, staffOf, custOf, tokenLabel, STATUS,
  renderTemplate, templateVars, relativeDay, svcName, staffRole, staffRoom, channelLabel,
  eventText, templateText,
} from '../data.js';
import { t } from '../main.js';
import { openBooking, openReschedule, cancelBooking } from '../booking.js';
import { openToken, tokenButton } from '../token.js';
import { drawer } from '../drawer.js';

const RANGE_IDS = ['upcoming', 'past', 'all'];

const state = { q: '', status: '', service: '', staff: '', range: 'upcoming' };

function detail(ctx, b) {
  const s = ctx.state;
  const svc = svcOf(s, b.serviceId);
  const st = staffOf(s, b.staffId);
  const cust = custOf(s, b.customerId);
  const noteIn = h('textarea', { class: 'textarea', style: 'min-height:70px' }, b.note || '');
  const saveNote = h('button', { class: 'btn btn--sm' }, t('common.saveNote'));
  saveNote.addEventListener('click', () => {
    ctx.store.update((draft) => {
      const rec = draft.bookings.find((x) => x.id === b.id);
      if (rec) rec.note = noteIn.value.trim();
    });
    toast(t('common.noteSaved'), 'ok');
  });

  const body = h('div', { class: 'stack' },
    h('div', { class: 'row' },
      h('span', { class: `pill ${(STATUS[b.status] || STATUS.booked).pill}` }, (STATUS[b.status] || STATUS.booked).label),
      h('span', { class: 'pill' }, channelLabel(b.channel))),
    h('dl', { class: 'kv' },
      h('dt', {}, t('bookings.kv.token')), h('dd', { class: 'mono' }, tokenLabel(s, b)),
      h('dt', {}, t('bookings.kv.when')), h('dd', {}, `${dayLabel(b.date)} · ${hm12(b.time)} — ${hm12(toHM(toMin(b.time) + b.blockMin))}`),
      h('dt', {}, t('bookings.kv.service')), h('dd', {}, t('bookings.serviceLine', { name: svcName(svc), duration: svc.durationMin, buffer: svc.bufferMin })),
      h('dt', {}, t('bookings.kv.staff')), h('dd', {}, `${st.name} · ${staffRole(st)} · ${staffRoom(st)}`),
      h('dt', {}, t('bookings.kv.customer')), h('dd', {}, `${cust.name} · ${cust.phone}`),
      h('dt', {}, t('bookings.kv.price')), h('dd', { class: 'mono' }, `${s.settings.currency}${svc.priceInr}`),
      h('dt', {}, t('bookings.kv.created')), h('dd', {}, ago(b.createdAt))),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:6px' }, t('bookings.confirmationSent')),
      h('div', { class: 'bubble' },
        h('div', { class: 'bubble__from' }, t('bookings.to', { phone: cust.phone })),
        renderTemplate(templateText(s, 'confirmTemplate'), templateVars(s, b)))),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:6px' }, t('bookings.deskNote')),
      noteIn,
      h('div', { style: 'margin-top:8px' }, saveNote)),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:8px' }, t('bookings.history')),
      h('div', { class: 'hist' }, (b.history && b.history.length ? b.history : [{ at: b.createdAt, key: 'created' }])
        .map((e) => h('div', { class: 'hist__i' },
          h('div', { class: 'hist__t' }, ago(e.at)),
          h('div', {}, eventText(e)))))));

  drawer({
    title: `${b.ref} · ${cust.name}`,
    subtitle: t('bookings.subtitle', { day: relativeDay(b.date), time: hm12(b.time) }),
    body,
    actions: [
      { label: t('bookings.showToken'), onClick: () => { openToken(ctx, b, { title: t('bookings.tokenTitle', { day: relativeDay(b.date) }) }); } },
      { label: t('bookings.reschedule'), onClick: () => { openReschedule(ctx, b); } },
      { label: t('bookings.cancelBooking'), class: 'btn--danger', onClick: () => { cancelBooking(ctx, b); } },
    ],
  });
}

export default function renderBookings(ctx) {
  const s = ctx.state;
  const today = todayKey();
  const wrap = h('div', {});

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, t('bookings.title')),
      h('p', {}, t('bookings.lede'))),
    h('div', { class: 'btnrow' },
      (() => {
        const b = h('button', { class: 'btn', html: `${icon('download')}<span>${t('common.exportCsv')}</span>` });
        b.addEventListener('click', () => {
          const rows = [t('bookings.csv').slice()];
          filtered().forEach((b2) => rows.push([
            b2.ref, tokenLabel(s, b2), b2.date, b2.time, custOf(s, b2.customerId).name,
            svcName(svcOf(s, b2.serviceId)), staffOf(s, b2.staffId).name, channelLabel(b2.channel),
            (STATUS[b2.status] || {}).label || b2.status, svcOf(s, b2.serviceId).priceInr,
          ]));
          downloadCSV(`slotly-bookings-${today}.csv`, rows);
          toast(t('bookings.exported', { n: rows.length - 1 }), 'ok');
        });
        return b;
      })(),
      (() => {
        const b = h('button', { class: 'btn btn--primary', html: `${icon('plus')}<span>${t('common.newBooking')}</span>` });
        b.addEventListener('click', () => openBooking(ctx, {}));
        return b;
      })())));

  /* ---- toolbar ---- */
  const search = h('div', { class: 'search' },
    h('span', { html: icon('search') }),
    h('input', { class: 'input', placeholder: t('bookings.search'), value: state.q, 'aria-label': t('bookings.searchAria') }));
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

  const rangeSeg = h('div', { class: 'seg', role: 'group', 'aria-label': t('bookings.rangeAria') },
    RANGE_IDS.map((id) => {
      const b = h('button', { type: 'button', class: state.range === id ? 'is-on' : '', 'aria-pressed': String(state.range === id) }, t(`bookings.ranges.${id}`));
      b.addEventListener('click', () => { state.range = id; redraw(); });
      return b;
    }));

  wrap.appendChild(h('div', { class: 'toolbar' },
    rangeSeg,
    search,
    sel(t('bookings.anyStatus'), 'status', Object.keys(STATUS).map((k) => ({ id: k, name: STATUS[k].label }))),
    sel(t('bookings.anyService'), 'service', s.services.map((x) => ({ id: x.id, name: svcName(x) }))),
    sel(t('bookings.anyStaff'), 'staff', s.staff.map((x) => ({ id: x.id, name: x.name })))));

  function filtered() {
    const q = state.q.trim().toLowerCase();
    return s.bookings.filter((b) => {
      if (state.range === 'upcoming' && b.date < today) return false;
      if (state.range === 'past' && b.date >= today) return false;
      if (state.status && b.status !== state.status) return false;
      if (state.service && b.serviceId !== state.service) return false;
      if (state.staff && b.staffId !== state.staff) return false;
      if (q) {
        const hay = `${b.ref} ${tokenLabel(s, b)} ${custOf(s, b.customerId).name} ${svcOf(s, b.serviceId).name} ${svcName(svcOf(s, b.serviceId))} ${staffOf(s, b.staffId).name}`.toLowerCase();
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
      t('bookings.count', { n: rows.length, open: rows.filter((b) => b.status === 'booked').length })));

    if (!rows.length) {
      host.appendChild(h('div', { class: 'empty' },
        h('h3', {}, t('bookings.emptyHead')),
        h('p', { class: 'small' }, t('bookings.emptyBody'))));
      return;
    }

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        t('bookings.cols').map((c) => h('th', { class: c === '' ? 'right' : '' }, c)))),
      h('tbody', {}, rows.map((b) => {
        const st = STATUS[b.status] || STATUS.booked;
        const ref = h('span', { class: 'linkish', role: 'button', tabindex: '0' }, b.ref);
        const open = () => detail(ctx, b);
        ref.addEventListener('click', open);
        ref.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });

        const move = h('button', { class: 'btn btn--sm', 'aria-label': t('bookings.moveAria', { ref: b.ref }) }, t('common.move'));
        move.addEventListener('click', () => openReschedule(ctx, b));
        const cancel = h('button', { class: 'btn btn--sm btn--danger', 'aria-label': t('bookings.cancelAria', { ref: b.ref }) }, t('common.cancel'));
        cancel.addEventListener('click', () => cancelBooking(ctx, b));
        const closed = b.status === 'cancelled' || b.status === 'done' || b.status === 'no-show';

        return h('tr', {},
          h('td', { class: 'mono' }, ref),
          h('td', { class: 'mono' }, tokenLabel(s, b)),
          h('td', {}, h('div', {}, relativeDay(b.date)), h('div', { class: 'mono small faint' }, hm12(b.time))),
          h('td', {}, custOf(s, b.customerId).name),
          h('td', {}, h('div', {}, svcName(svcOf(s, b.serviceId))), h('div', { class: 'small faint mono' }, `${s.settings.currency}${svcOf(s, b.serviceId).priceInr}`)),
          h('td', {}, staffOf(s, b.staffId).name),
          h('td', {}, h('span', { class: `pill ${st.pill}` }, st.label)),
          h('td', { class: 'right' }, h('div', { class: 'btnrow', style: 'justify-content:flex-end' },
            b.status === 'cancelled' ? null : tokenButton(ctx, b),
            closed ? null : move, closed ? null : cancel)));
      })));

    host.appendChild(h('div', { class: 'tablewrap tablewrap--scroll' }, table));
  }

  redraw();
  return wrap;
}

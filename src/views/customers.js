/* Customers — visit history and how often each one fails to turn up. */

import { h, icon, meter, money, toast, downloadCSV } from '../../lib/ui.js';
import {
  todayKey, dayLabel, hm12, customerStats, svcOf, staffOf, tokenLabel, STATUS, relativeDay,
} from '../data.js';
import { openBooking } from '../booking.js';
import { drawer } from '../drawer.js';

const view = { q: '', sort: 'name', risky: false };

function detail(ctx, c) {
  const s = ctx.state;
  const stats = customerStats(s, c.id);
  const history = s.bookings.filter((b) => b.customerId === c.id)
    .sort((a, b) => (b.date === a.date ? b.time.localeCompare(a.time) : b.date.localeCompare(a.date)));

  const noteIn = h('textarea', { class: 'textarea', style: 'min-height:64px' }, c.note || '');
  const saveNote = h('button', { class: 'btn btn--sm' }, 'Save note');
  saveNote.addEventListener('click', () => {
    ctx.store.update((d) => {
      const rec = d.customers.find((x) => x.id === c.id);
      if (rec) rec.note = noteIn.value.trim();
    });
    toast('Note saved', 'ok');
  });

  const stripe = h('div', { class: 'stripe' }, history.slice(0, 16).reverse().map((b) => h('i', {
    class: b.status === 'done' ? 'ok' : b.status === 'no-show' ? 'miss' : 'cut',
    title: `${dayLabel(b.date)} · ${(STATUS[b.status] || {}).label || b.status}`,
  })));

  const body = h('div', { class: 'stack' },
    h('dl', { class: 'kv' },
      h('dt', {}, 'Phone'), h('dd', { class: 'mono' }, c.phone),
      h('dt', {}, 'Email'), h('dd', {}, c.email || '—'),
      h('dt', {}, 'On file since'), h('dd', {}, dayLabel(c.since)),
      h('dt', {}, 'Visits'), h('dd', {}, `${stats.attended} completed of ${stats.total} booked`),
      h('dt', {}, 'No-shows'), h('dd', {}, `${stats.noShows} · rate ${stats.rate}%`),
      h('dt', {}, 'Cancelled'), h('dd', {}, String(stats.cancelled)),
      h('dt', {}, 'Billed'), h('dd', { class: 'mono' }, money(stats.spend, s.settings.currency))),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:8px' }, 'Last 16 bookings — green kept, red missed, grey cancelled'),
      stripe),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:6px' }, 'Desk note'),
      noteIn,
      h('div', { style: 'margin-top:8px' }, saveNote)),
    h('div', {},
      h('div', { class: 'label', style: 'margin-bottom:8px' }, 'Booking history'),
      history.length
        ? h('div', { class: 'hist' }, history.slice(0, 20).map((b) => h('div', { class: 'hist__i' },
          h('div', { class: 'hist__t' }, `${relativeDay(b.date)} · ${hm12(b.time)} · ${tokenLabel(s, b)}`),
          h('div', {}, `${svcOf(s, b.serviceId).name} with ${staffOf(s, b.staffId).name} — ${(STATUS[b.status] || {}).label || b.status}`))))
        : h('p', { class: 'small muted' }, 'Nothing booked yet.')));

  drawer({
    title: c.name,
    subtitle: `${stats.total} bookings · no-show rate ${stats.rate}%`,
    body,
    actions: [{ label: 'Book a slot', class: 'btn--primary', onClick: () => openBooking(ctx, { customerId: c.id }) }],
  });
}

export default function renderCustomers(ctx) {
  const s = ctx.state;
  const wrap = h('div', {});
  const rows = s.customers.map((c) => ({ c, st: customerStats(s, c.id) }));
  const risky = rows.filter((r) => r.st.rate >= 25 && r.st.noShows >= 2);
  const totalNoShows = rows.reduce((n, r) => n + r.st.noShows, 0);
  const totalSettled = rows.reduce((n, r) => n + r.st.attended + r.st.noShows, 0);

  wrap.appendChild(h('div', { class: 'page-head' },
    h('div', { style: 'flex:1;min-width:220px' },
      h('h1', {}, 'Customers'),
      h('p', {}, 'Who books, who turns up, who does not. The no-show rate counts missed appointments against appointments that were settled either way — cancellations are excluded.')),
    (() => {
      const b = h('button', { class: 'btn', html: `${icon('download')}<span>Export CSV</span>` });
      b.addEventListener('click', () => {
        const out = [['Name', 'Phone', 'Bookings', 'Attended', 'No-shows', 'No-show rate %', 'Billed', 'Last visit']];
        rows.forEach(({ c, st }) => out.push([c.name, c.phone, st.total, st.attended, st.noShows, st.rate, st.spend, st.last || '']));
        downloadCSV(`slotly-customers-${todayKey()}.csv`, out);
        toast(`${rows.length} customers exported`, 'ok');
      });
      return b;
    })()));

  wrap.appendChild(h('div', { class: 'grid g4', style: 'margin-bottom:18px' },
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'On file'),
      h('div', { class: 'stat__value' }, String(rows.length)),
      h('div', { class: 'stat__delta' }, `${rows.filter((r) => r.st.upcoming).length} with something booked ahead`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Desk no-show rate'),
      h('div', { class: 'stat__value' }, `${totalSettled ? Math.round((totalNoShows / totalSettled) * 100) : 0}%`),
      h('div', { class: 'stat__delta' }, `${totalNoShows} missed of ${totalSettled} settled`)),
    h('div', { class: 'stat' },
      h('div', { class: 'stat__label' }, 'Repeat visitors'),
      h('div', { class: 'stat__value' }, String(rows.filter((r) => r.st.attended >= 3).length)),
      h('div', { class: 'stat__delta' }, 'Three or more completed visits')),
    h('div', { class: 'stat stat--accent' },
      h('div', { class: 'stat__label' }, 'Worth a reminder call'),
      h('div', { class: 'stat__value' }, String(risky.length)),
      h('div', { class: 'stat__delta' }, 'No-show rate at or above 25%'))));

  const search = h('div', { class: 'search' },
    h('span', { html: icon('search') }),
    h('input', { class: 'input', placeholder: 'Search a name or phone', value: view.q, 'aria-label': 'Search customers' }));
  search.querySelector('input').addEventListener('input', (e) => { view.q = e.target.value; draw(); });

  const sortSel = h('select', { class: 'select', style: 'max-width:200px', 'aria-label': 'Sort customers' },
    [['name', 'Name A–Z'], ['visits', 'Most visits'], ['rate', 'Highest no-show rate'], ['spend', 'Most billed'], ['recent', 'Most recent visit']]
      .map(([id, label]) => h('option', { value: id, selected: view.sort === id }, label)));
  sortSel.addEventListener('change', () => { view.sort = sortSel.value; draw(); });

  const riskChip = h('button', { class: `chip${view.risky ? ' is-on' : ''}`, 'aria-pressed': String(view.risky) }, 'Only reminder-call list');
  riskChip.addEventListener('click', () => { view.risky = !view.risky; draw(); });

  wrap.appendChild(h('div', { class: 'toolbar' }, search, sortSel, riskChip));

  const host = h('div', {});
  wrap.appendChild(host);

  function draw() {
    const q = view.q.trim().toLowerCase();
    let list = rows.filter(({ c }) => !q || `${c.name} ${c.phone} ${c.email}`.toLowerCase().includes(q));
    if (view.risky) list = list.filter((r) => r.st.rate >= 25 && r.st.noShows >= 2);
    list = list.slice().sort((a, b) => {
      if (view.sort === 'visits') return b.st.attended - a.st.attended;
      if (view.sort === 'rate') return b.st.rate - a.st.rate || b.st.noShows - a.st.noShows;
      if (view.sort === 'spend') return b.st.spend - a.st.spend;
      if (view.sort === 'recent') return String(b.st.last || '').localeCompare(String(a.st.last || ''));
      return a.c.name.localeCompare(b.c.name);
    });

    host.innerHTML = '';
    if (!list.length) {
      host.appendChild(h('div', { class: 'empty' },
        h('h3', {}, 'No customer matches'),
        h('p', { class: 'small' }, 'Clear the search box or switch the reminder-call filter off.')));
      return;
    }

    const table = h('table', { class: 'data' },
      h('thead', {}, h('tr', {},
        ['Customer', 'Phone', 'Visits', 'No-shows', 'No-show rate', 'Billed', 'Last visit', ''].map((c) =>
          h('th', { class: /Visits|No-shows|Billed/.test(c) ? 'right' : '' }, c)))),
      h('tbody', {}, list.map(({ c, st }) => {
        const name = h('span', { class: 'linkish', role: 'button', tabindex: '0' }, c.name);
        const open = () => detail(ctx, c);
        name.addEventListener('click', open);
        name.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
        const book = h('button', { class: 'btn btn--sm', 'aria-label': `Book a slot for ${c.name}` }, 'Book');
        book.addEventListener('click', () => openBooking(ctx, { customerId: c.id }));

        return h('tr', {},
          h('td', {}, h('div', {}, name),
            c.tags && c.tags.length ? h('div', { class: 'small faint' }, c.tags.join(' · ')) : null),
          h('td', { class: 'mono small' }, c.phone),
          h('td', { class: 'right mono' }, String(st.attended)),
          h('td', { class: 'right mono' }, String(st.noShows)),
          h('td', {}, h('div', { class: 'loadbar' },
            meter(st.rate, 100, st.rate >= 25 ? 'bad' : 'ok'),
            h('span', { class: 'mono small', style: 'width:42px;text-align:right' }, `${st.rate}%`))),
          h('td', { class: 'right mono' }, money(st.spend, s.settings.currency)),
          h('td', { class: 'small' }, st.last ? dayLabel(st.last) : '—'),
          h('td', { class: 'right' }, book));
      })));

    host.appendChild(h('div', { class: 'tablewrap tablewrap--scroll' }, table));
  }

  draw();
  return wrap;
}

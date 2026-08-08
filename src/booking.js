/* ============================================================
   slotly — the booking dialog, shared by Today, Calendar and Bookings.
   Creating or moving a booking here writes to the store, which blocks
   the slot everywhere else in the app.
   ============================================================ */

import { h, modal, toast, confirmDialog, qs } from '../lib/ui.js';
import {
  todayKey, dayLabel, hm12, toMin, deskNowMin, freeSlots, freeStaffAt, staffOf, svcOf, custOf,
  createBooking, assignTokens, logEvent, tokenLabel, relativeDay, isOpenDay,
} from './data.js';

const ANY = '__any';

function slotPicker(state, { date, serviceId, staffId, ignoreId, selected, onPick }) {
  const wrap = h('div', { class: 'slotgrid' });
  const cutoff = date === todayKey() ? deskNowMin(state.settings) : -1;
  const slots = freeSlots(state, date, serviceId, staffId === ANY ? null : staffId, ignoreId)
    .filter((s) => toMin(s.time) > cutoff);
  if (!slots.length) {
    return h('div', { class: 'empty', style: 'padding:20px' },
      h('h3', {}, isOpenDay(state, date) ? 'No open slot' : 'Desk closed'),
      h('p', { class: 'small muted' }, isOpenDay(state, date)
        ? 'Every slot for that service is taken on this day. Try another day or another staff member.'
        : 'The desk does not open on this day. Pick another date.'));
  }
  slots.forEach((s) => {
    const names = s.staffIds.map((id) => staffOf(state, id).initials).join(' ');
    const btn = h('button', {
      type: 'button',
      class: `slotbtn${selected === s.time ? ' is-on' : ''}`,
      'aria-pressed': selected === s.time ? 'true' : 'false',
    }, hm12(s.time), h('small', {}, names));
    btn.addEventListener('click', () => {
      [...wrap.querySelectorAll('.slotbtn')].forEach((b) => { b.classList.remove('is-on'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('is-on');
      btn.setAttribute('aria-pressed', 'true');
      onPick(s.time);
    });
    wrap.appendChild(btn);
  });
  return wrap;
}

function customerField(state, chosen) {
  const sel = h('select', { class: 'select', name: 'customer', 'aria-label': 'Customer' },
    h('option', { value: '__new' }, 'New customer…'),
    state.customers.slice().sort((a, b) => a.name.localeCompare(b.name))
      .map((c) => h('option', { value: c.id, selected: c.id === chosen }, `${c.name} · ${c.phone}`)));
  return sel;
}

/**
 * Open the booking dialog.
 * prefill: { date, time, serviceId, staffId, customerId }
 */
export function openBooking(ctx, prefill = {}) {
  const state = ctx.state;
  const active = state.services.filter((s) => s.active);
  if (!active.length) { toast('Switch on at least one service first', 'bad'); return; }

  const draft = {
    date: prefill.date || todayKey(),
    serviceId: prefill.serviceId || active[0].id,
    staffId: prefill.staffId || ANY,
    time: prefill.time || '',
    customerId: prefill.customerId || (state.customers[0] && state.customers[0].id),
    channel: 'Front desk',
    note: '',
  };
  if (!state.services.find((s) => s.id === draft.serviceId && s.active)) draft.serviceId = active[0].id;

  const slotHost = h('div', {});
  const staffSel = h('select', { class: 'select', name: 'staff', 'aria-label': 'Staff member' });
  const svcSel = h('select', { class: 'select', name: 'service', 'aria-label': 'Service' });
  const dateIn = h('input', { class: 'input', type: 'date', value: draft.date, min: todayKey(), 'aria-label': 'Date' });
  const custSel = customerField(state, draft.customerId);
  const newName = h('input', { class: 'input', placeholder: 'Full name' });
  const newPhone = h('input', { class: 'input', placeholder: '+91 ••••• 0000' });
  const newWrap = h('div', { class: 'fieldrow', style: 'margin-top:12px' },
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Name'), newName),
    h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Phone'), newPhone));
  newWrap.hidden = true;
  const noteIn = h('input', { class: 'input', placeholder: 'Optional note for the desk' });
  const channelSel = h('select', { class: 'select', 'aria-label': 'Channel' },
    ['Front desk', 'Phone', 'Website', 'Walk-in'].map((c) => h('option', { value: c }, c)));
  const summary = h('p', { class: 'hint' }, '');

  const fillServices = () => {
    svcSel.innerHTML = '';
    active.forEach((s) => svcSel.appendChild(h('option', {
      value: s.id, selected: s.id === draft.serviceId,
    }, `${s.name} · ${s.durationMin} min · ${state.settings.currency}${s.priceInr}`)));
  };
  const fillStaff = () => {
    const eligible = state.staff.filter((s) => s.active && s.skills.includes(draft.serviceId));
    staffSel.innerHTML = '';
    staffSel.appendChild(h('option', { value: ANY, selected: draft.staffId === ANY }, 'Any available'));
    eligible.forEach((s) => staffSel.appendChild(h('option', {
      value: s.id, selected: s.id === draft.staffId,
    }, `${s.name} · ${s.role}`)));
    if (draft.staffId !== ANY && !eligible.some((s) => s.id === draft.staffId)) draft.staffId = ANY;
  };
  const refreshSlots = () => {
    slotHost.innerHTML = '';
    slotHost.appendChild(slotPicker(state, {
      date: draft.date, serviceId: draft.serviceId, staffId: draft.staffId,
      ignoreId: prefill.ignoreId, selected: draft.time,
      onPick: (t) => { draft.time = t; updateSummary(); },
    }));
    const cutoff = draft.date === todayKey() ? deskNowMin(state.settings) : -1;
    const still = freeSlots(state, draft.date, draft.serviceId, draft.staffId === ANY ? null : draft.staffId, prefill.ignoreId)
      .some((s) => s.time === draft.time && toMin(s.time) > cutoff);
    if (!still) draft.time = '';
    updateSummary();
  };
  const updateSummary = () => {
    const svc = svcOf(state, draft.serviceId);
    if (!draft.time) { summary.textContent = 'Pick a time to see who takes it.'; return; }
    const ids = freeStaffAt(state, draft.date, draft.time, draft.serviceId, prefill.ignoreId)
      .filter((id) => draft.staffId === ANY || id === draft.staffId);
    const who = ids.length ? staffOf(state, ids[0]).name : 'nobody free';
    summary.textContent = `${relativeDay(draft.date)} at ${hm12(draft.time)} · ${svc.durationMin} min plus ${svc.bufferMin} min buffer · ${who}.`;
  };

  fillServices();
  fillStaff();

  svcSel.addEventListener('change', () => { draft.serviceId = svcSel.value; fillStaff(); refreshSlots(); });
  staffSel.addEventListener('change', () => { draft.staffId = staffSel.value; refreshSlots(); });
  dateIn.addEventListener('change', () => { draft.date = dateIn.value || todayKey(); refreshSlots(); });
  custSel.addEventListener('change', () => { newWrap.hidden = custSel.value !== '__new'; });

  const body = h('div', {},
    h('div', { class: 'fieldrow' },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Service'), svcSel),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Staff'), staffSel)),
    h('div', { class: 'fieldrow', style: 'margin-top:14px' },
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Date'), dateIn),
      h('label', { class: 'field' }, h('span', { class: 'field__label' }, 'Channel'), channelSel)),
    h('div', { class: 'field', style: 'margin-top:14px' },
      h('span', { class: 'field__label' }, 'Open slots'), slotHost, summary),
    h('label', { class: 'field', style: 'margin-top:14px' },
      h('span', { class: 'field__label' }, 'Customer'), custSel),
    newWrap,
    h('label', { class: 'field', style: 'margin-top:14px' },
      h('span', { class: 'field__label' }, 'Note'), noteIn));

  refreshSlots();

  const dlg = modal({
    title: prefill.title || 'New booking',
    width: '560px',
    body,
    actions: [
      { label: 'Cancel' },
      {
        label: prefill.okLabel || 'Book slot',
        class: 'btn--primary',
        onClick: () => {
          if (!draft.time) { toast('Pick a time slot first', 'bad'); return true; }
          let customerId = custSel.value;
          if (customerId === '__new') {
            const name = newName.value.trim();
            if (!name) { toast('Give the new customer a name', 'bad'); return true; }
            customerId = `cus-${Math.random().toString(36).slice(2, 8)}`;
            ctx.store.update((s) => {
              s.customers.push({
                id: customerId, name, phone: newPhone.value.trim() || '+91 ••••• 0000',
                email: '', since: todayKey(), tags: [], note: '',
              });
            });
          }
          const ids = freeStaffAt(ctx.state, draft.date, draft.time, draft.serviceId, prefill.ignoreId)
            .filter((id) => draft.staffId === ANY || id === draft.staffId);
          if (!ids.length) { toast('That slot just filled up — pick another', 'bad'); refreshSlots(); return true; }

          let made = null;
          ctx.store.update((s) => {
            made = createBooking(s, {
              date: draft.date, time: draft.time, serviceId: draft.serviceId,
              staffId: ids[0], customerId, channel: channelSel.value, note: noteIn.value.trim(),
            });
          });
          const label = made ? tokenLabel(ctx.state, ctx.state.bookings.find((b) => b.id === made.id)) : '';
          toast(`Booked ${label} — ${custOf(ctx.state, customerId).name}, ${relativeDay(draft.date)} ${hm12(draft.time)}`, 'ok');
          if (prefill.onDone) prefill.onDone(made);
          return false;
        },
      },
    ],
  });
  setTimeout(() => { const f = qs('.slotbtn', dlg.body); if (f) f.focus(); }, 40);
}

/** Move an existing booking. Keeps the reference, re-issues the token. */
export function openReschedule(ctx, booking) {
  const state = ctx.state;
  openBooking(ctx, {
    title: `Reschedule ${booking.ref}`,
    okLabel: 'Move booking',
    date: booking.date,
    serviceId: booking.serviceId,
    staffId: booking.staffId,
    customerId: booking.customerId,
    ignoreId: booking.id,
    onDone: (made) => {
      ctx.store.update((s) => {
        const fresh = s.bookings.find((b) => b.id === made.id);
        const old = s.bookings.find((b) => b.id === booking.id);
        if (!fresh || !old) return;
        fresh.ref = old.ref;
        fresh.note = old.note || fresh.note;
        fresh.history = old.history || [];
        logEvent(fresh, `Moved from ${dayLabel(old.date)} ${hm12(old.time)} to ${dayLabel(fresh.date)} ${hm12(fresh.time)}`);
        s.bookings = s.bookings.filter((b) => b.id !== old.id);
        assignTokens(s.bookings);
      });
      toast(`${booking.ref} moved`, 'ok');
    },
  });
  void state;
}

export async function cancelBooking(ctx, booking) {
  const name = custOf(ctx.state, booking.customerId).name;
  const ok = await confirmDialog(
    `Cancel ${booking.ref} for ${name} on ${dayLabel(booking.date)} at ${hm12(booking.time)}? The slot goes back on the grid.`,
    { title: 'Cancel booking', danger: true, okLabel: 'Cancel booking' });
  if (!ok) return false;
  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === booking.id);
    if (!b) return;
    b.status = 'cancelled';
    logEvent(b, 'Cancelled at the front desk');
  });
  toast(`${booking.ref} cancelled`, '');
  return true;
}

export function setStatus(ctx, booking, status, label) {
  ctx.store.update((s) => {
    const b = s.bookings.find((x) => x.id === booking.id);
    if (!b) return;
    b.status = status;
    logEvent(b, label || `Marked ${status}`);
  });
}

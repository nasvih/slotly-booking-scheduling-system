/* Right-hand detail drawer. Same visual language as the modal in lib/ui.js. */

import { h, icon } from '../lib/ui.js';

export function drawer({ title, subtitle, body, actions = [] }) {
  const scrim = h('div', { class: 'scrim', style: 'place-items:stretch;padding:0' });
  const close = () => {
    scrim.remove();
    document.removeEventListener('keydown', onKey);
  };
  function onKey(e) { if (e.key === 'Escape') close(); }

  const closeBtn = h('button', { class: 'btn btn--ghost btn--icon', 'aria-label': 'Close panel', html: icon('x') });
  closeBtn.addEventListener('click', close);

  const panel = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': title || 'Details' },
    h('div', { class: 'drawer__head' },
      h('div', { style: 'flex:1;min-width:0' },
        h('div', { class: 'topbar__title truncate' }, title || ''),
        subtitle ? h('div', { class: 'topbar__sub truncate' }, subtitle) : null),
      closeBtn),
    h('div', { class: 'drawer__body' }, body),
    actions.length
      ? h('div', { class: 'modal__foot' }, actions.map((a) => {
        const b = h('button', { class: `btn ${a.class || ''}` }, a.label);
        b.addEventListener('click', async () => {
          const keep = a.onClick ? await a.onClick() : false;
          if (!keep) close();
        });
        return b;
      }))
      : null);

  scrim.appendChild(panel);
  scrim.addEventListener('click', (e) => { if (e.target === scrim) close(); });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(scrim);
  setTimeout(() => closeBtn.focus(), 30);
  return { close, panel };
}

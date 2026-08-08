# slotly

A front-desk booking and scheduling application. Token queue, week calendar across three
staff resources, bookings with reschedule and cancel, services, working hours, customer
no-show history and message templates.

Plain HTML, CSS and ES modules. No dependencies, no build step, no bundler, no framework,
no backend. It runs from any static file server and from GitHub Pages unchanged.

**Author:** Muhammed Nasvih V — [nasvih.in](https://www.nasvih.in) · [github.com/nasvih](https://github.com/nasvih)

---

## What this is

Slotly runs a front desk. Booked appointments and walk-in tokens sit in the same queue on the
same day, a week calendar shows every staff member side by side, and each service carries its
own duration and buffer so the diary reflects how long the work actually takes. Every booking
has a confirmation message written from a template.

## Where it helps a business

- The diary stops being a paper book that only one person can read.
- Double-booking becomes impossible — the slot is held the moment it is taken.
- Walk-ins get a token instead of a crowd at the counter.
- No-show patterns become visible per customer instead of being felt.
- Staff hours, breaks and days off are part of the booking rules, not something the
  receptionist has to remember.

## How it would work for real

The same interface, with browser storage swapped for a real database, staff accounts behind a
login, and confirmations actually sent by message or email. What you are looking at is the
interface and the workflow, not the production system behind them.

## How this demo works

**You can actually use it.** Every screen is live. Book a slot, move it, cancel it, call a
token, mark a no-show, edit a rota, add a service, rewrite a message template — nothing here
is read-only and nothing is a mock-up. Booking a slot really does block it everywhere else.

**Your data stays on your machine.** Everything you enter is saved in this browser's local
storage under the key `slotly.v1`. There is no account, no server and no backend behind this
build. Clear your browser data or use **Reset demo data** and it is all gone. It does not
sync between browsers or devices.

**The assistant is simulated.** *Slotly Desk* answers by matching your question against this
app's own demo data. It is a demonstration of the interaction, not a connected model, and no
request leaves your browser.

The same four blocks are in the app, under **About this demo** in the sidebar footer and
behind the `DEMO` pill in the topbar.

---

## Screens

| Screen | What it does |
|---|---|
| **Today** | The live token queue for the current day. Call next, call, start serving, mark done, mark no-show, undo. Stats for queue length, served, no-shows, chair time booked, plus a per-staff load bar. Filter by waiting / served / no-show / cancelled. |
| **Calendar** | Week grid, time down the side, seven days across, all three staff resources on one sheet. Pick a service and a staff filter; free cells show `+ N free` and open the booking dialog on click. Past slots, closed days and off-shift hours are locked. |
| **Bookings** | Every record. Range (upcoming / past / all), status, service and staff filters, text search, CSV export. Row detail drawer with the confirmation message that went out, an editable desk note and the change history. Reschedule keeps the reference and re-issues the token; cancel asks for confirmation and releases the slot. |
| **Services** | Duration, buffer, price, block length, staff who can take it, completed appointments and revenue for the last 30 days, a bar chart, an active toggle and add/edit forms. |
| **Staff** | One card per person: working days, shift start and end, break window, room, per-service skills and a taking-bookings switch. Saving a rota reshapes the calendar immediately and warns if bookings now fall outside the shift. |
| **Customers** | Visit history and no-show rate per customer, sortable, with a reminder-call filter for anyone at 25% or above. Detail drawer with a 16-booking outcome strip, a desk note and full history. CSV export. |
| **Settings** | Desk name, opening and closing time, slot length, closed days, token prefix. Three message templates with `{{name}}`-style placeholders, insertable placeholder chips and a live preview rendered against a real booking. Demo data counts and the reset action. |

The sidebar is the brand yellow by default, with ink text on it. Two controls in its footer
switch it to plain white and collapse it to a 64px icon rail; both choices persist under
their own `slotly.ui` key, separate from the demo data. The footer also holds **Reset demo
data**, **About this demo**, a link to nasvih.in, and — where the browser offers it — an
**Install app** button. The assistant has a single entry point: the round launcher at the
bottom right, or `⌘K` / `Ctrl+K`.

Three flows that persist through `localStorage`: **booking** (calendar or dialog → blocks the
slot → appears in Today), **queue state changes** (call / serve / done / no-show / undo),
**setup edits** (service prices and toggles, staff rotas, message templates, desk notes).

---

## Run it

No install step. Serve the folder over HTTP — ES modules will not load from `file://`.

```sh
cd slotly
python3 -m http.server 4102
```

Then open <http://localhost:4102>.

Any static server works just as well (`npx serve`, `php -S`, nginx, Caddy).

## Install it

Slotly is a progressive web app. Over HTTPS (or `localhost`) the browser offers to install it,
and an **Install app** button appears in the sidebar footer at the same moment — on iPhone and
iPad, where there is no install prompt, the button explains the **Share → Add to Home Screen**
route instead. Installed, it opens in its own window with no browser chrome.

A service worker (`sw.js`) caches the whole app shell on first load — every stylesheet, every
module, the icons and the manifest — so a reload works with no connection at all. There is
nothing to sync, because the data was never on a server in the first place.

If you change, add or remove a file, add it to the `SHELL` array in `sw.js` and bump
`CACHE_VERSION`. A file that is missing from the list will not be there offline; a file listed
that does not exist fails the whole install.

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. **Settings → Pages → Build and deployment → Deploy from a branch**, branch `main`, folder `/ (root)`.
3. Wait for the first build, then open `https://<user>.github.io/slotly/`.

The repository already contains `.nojekyll`, so Pages serves `/lib` and `/assets` untouched.
Paths in `index.html` are relative, so the app works from a subdirectory. The only external
request the page makes is to Google Fonts for Inter and JetBrains Mono; everything else is in
the repository.

---

## Structure

| Path | Purpose |
|---|---|
| `index.html` | The single page. Fonts, stylesheets, manifest link, `<noscript>` line, module entry. |
| `manifest.webmanifest` | Web app manifest: name, icons, `standalone` display, `#EAC81C` theme colour. |
| `sw.js` | Service worker. Caches the shell listed in `SHELL` so the app opens offline. |
| `assets/app.css` | Shared product design system: tokens, shell, buttons, tables, forms, modal, assistant. Unmodified. |
| `assets/slotly.css` | App-specific components only — queue rows, calendar grid, slot picker, staff cards, template preview, sidebar footer. |
| `assets/icons/` | Install icons: 192, 512 and a 512 maskable. |
| `lib/ui.js` | DOM helpers, formatting, seeded random, `createStore`, hash router, toast, modal, confirm, CSV, bar chart, meter, icons. |
| `lib/assistant.js` | The assistant engine: intent routing, word-by-word streaming, panel and launcher. |
| `lib/pwa.js` | Service worker registration and the install control. |
| `src/main.js` | Boot: store, shell, nav, router, keyboard shortcuts, about modal, assistant mount, install control. |
| `src/data.js` | Seeded dataset and every scheduling calculation — availability, utilisation, no-show rates, templates. |
| `src/agent.js` | The twelve *Slotly Desk* intents, each reading live store state. |
| `src/booking.js` | The booking dialog, reschedule, cancel and status changes, shared by three views. |
| `src/drawer.js` | Right-hand detail drawer. |
| `src/views/*.js` | One module per screen, each exporting `render(ctx) -> Node`. |

## Demo notes

- Every company, person, phone number and figure is invented. Phone numbers are masked on
  purpose and email addresses use `example.com`.
- The dataset is generated from a fixed seed, so the numbers are the same on every fresh
  load: 3 staff, 7 services, 24 customers and roughly 400 bookings spanning 14 days back and
  14 days forward.
- Prices are in rupees and come from the service list, never hard-coded into a screen.
- The app treats "now" as a clock clamped inside opening hours, so the queue and the calendar
  still have something live in them when you open it at midnight.

## Licence

MIT — see [LICENSE](LICENSE).

# slotly

A front-desk booking and scheduling application. Token queue, week calendar across three
staff resources, bookings with reschedule and cancel, services, working hours, customer
no-show history and message templates.

Plain HTML, CSS and ES modules. No dependencies, no build step, no bundler, no framework,
no backend. It runs from any static file server and from GitHub Pages unchanged.

**Author:** Muhammed Nasvih V — [nasvih.in](https://www.nasvih.in) · [github.com/nasvih](https://github.com/nasvih)

**Source:** [github.com/nasvih/slotly-booking-scheduling-system](https://github.com/nasvih/slotly-booking-scheduling-system)

Source-available, not open source. You may read it, run it locally and evaluate it. Copying,
modifying, redistributing or using it in your own work needs written permission — see
[LICENSE](LICENSE).

---

## Tech stack

- **Plain HTML, CSS and ES modules.** No dependencies, no build step, no bundler, no
  framework, no backend, no `fetch` to any host.
- **State in `localStorage`** — one JSON document under `slotly.v1`, seeded from a fixed
  pseudo-random sequence; interface preferences under `slotly.ui`, `slotly.theme` and
  `slotly.notify`.
- **Icons are inline stroke SVG** on `currentColor`. No icon font, no image sprites.
- **Inter and JetBrains Mono from Google Fonts** — the only external request the page makes.
- **A service worker and a web manifest** (`sw.js`, `manifest.webmanifest`) make it work
  offline and installable.
- **`<canvas>`** draws the downloadable token image, 1080 × 1350, saved as a PNG straight from
  the browser. No library, no server round trip.
- **A simulated assistant engine** (`lib/assistant.js` + `src/agent.js`, `src/actions.js`,
  `src/parse.js`): local intent matching over this app's own data, with answers and applied
  changes computed in the browser. There is no model and no network call behind it.

It deploys as static files anywhere — GitHub Pages, S3, Netlify, nginx, a USB stick.

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

**The assistant also does the work.** Ask it in plain words to book someone in, move a
booking, cancel one with a reason, call the next token, hold back a staff member's afternoon
or change a service. It shows you exactly which record it read, and writes nothing until you
press the button on its reply. Ask **what can you do?** for the list with an example each.

The same blocks are in the app, behind the **About this demo** button in the topbar.

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

### The token slip

Every booking — from the calendar, from the booking dialog or from the assistant — ends with a
plain rose slip in white type: the token in large mono, the `SL-…` reference under it, then
customer, service, staff, date and time. **Download** draws the same slip on a `<canvas>` at
1080 × 1350 and saves it as a PNG the visitor can keep; a line on the popup says a screenshot
works too. It is never a one-time thing — every booking row on **Today** and in **Bookings**
has a **Token** button that shows it again, and so does the row detail drawer.

### Topbar controls

| Control | What it does |
|---|---|
| **About this demo** | The modal: what this is, where it helps, what the assistant can change (with a worked example each), how the demo works, and where to read the source. |
| **Notifications** | A bell with an unread count. The list is worked out from the live bookings every time it opens: anything starting within the hour, today's no-shows, cancellations in the week ahead, and anyone running over or booked past their hours. Mark one or all read; the read marks persist under `slotly.notify`. Empty state when the desk is clear. |
| **Device preview** | Phone and desktop icons. Phone mode drops the whole app into a 390 × 844 `<iframe>` inside a rounded bezel on a rose surround, so the real breakpoints fire for the real reason. The framed copy carries `?frame=1` and hides the control, so there is no preview inside the preview. |
| **Dark mode** | Sets `data-theme="dark"` on `<html>` and persists it under `slotly.theme`. On a first visit it follows `prefers-color-scheme`, and keeps following the system until you press the switch. The rose stays a fill with white text in both themes. |

The sidebar is the brand rose by default, with white text on it. Two icon-only controls sit on
the brand row at the top, right of the name: a circle half filled switches between rose and
plain white (labelled *Sidebar colour* — it names no colour, and `aria-pressed` carries the
tone), and a panel with a chevron collapses the sidebar to a 64px icon rail. Both choices
persist under their own `slotly.ui` key, separate from the demo data. The footer below holds
nasvih.in beside **GitHub**, then **Reset demo data** — joined by an **Install app** button
where the browser offers one. The assistant has a single entry point: the round launcher at
the bottom right, or `⌘K` / `Ctrl+K`.

Flows that persist through `localStorage`: **booking** (calendar, dialog or assistant → blocks
the slot → appears in Today), **queue state changes** (call / serve / done / no-show / undo),
**setup edits** (service prices and toggles, staff rotas, message templates, desk notes),
**held staff time** (written by the assistant, released from the staff card) and the interface
preferences above.

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

If you add or remove a file, put it in the `SHELL` array in `sw.js`. A file missing from the
list will not be there offline; a file listed that does not exist fails the whole install. And
bump `CACHE_VERSION` whenever **any** cached file changes — the browser only reinstalls a
worker whose own bytes changed, so without that bump returning visitors keep the old copy.

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
| `manifest.webmanifest` | Web app manifest: name, icons, `standalone` display, `#B82D6E` theme colour. |
| `sw.js` | Service worker. Caches the shell listed in `SHELL` so the app opens offline. |
| `assets/app.css` | Shared product design system: tokens, shell, buttons, tables, forms, modal, assistant. Unmodified — the accent tokens are overridden in `slotly.css`, never here. |
| `assets/slotly.css` | The rose accent override (section 0) plus app-specific components — queue rows, calendar grid, slot picker, staff cards, template preview, sidebar footer. |
| `assets/icons/` | Install icons: 192, 512 and a 512 maskable. |
| `lib/ui.js` | DOM helpers, formatting, seeded random, `createStore`, hash router, toast, modal, confirm, CSV, bar chart, meter, icons. |
| `lib/assistant.js` | The assistant engine: intent routing, word-by-word streaming, panel and launcher. |
| `lib/pwa.js` | Service worker registration and the install control. |
| `src/main.js` | Boot: store, shell, nav, router, keyboard shortcuts, about modal, topbar controls, assistant mount, install control. |
| `src/data.js` | Seeded dataset and every scheduling calculation — availability, utilisation, no-show rates, held time, templates. |
| `src/agent.js` | The twelve reading *Slotly Desk* intents, each computed from live store state. |
| `src/actions.js` | The seven acting intents: book, reschedule, cancel, run the queue, hold staff time, change a service, and "what can you do?". |
| `src/parse.js` | Plain-language parsing shared by both: day, time, service, staff, customer, booking reference, window of a day. |
| `src/token.js` | The token slip popup and the canvas PNG it downloads. |
| `src/notify.js` | Notifications derived from live bookings, and the bell and panel. |
| `src/chrome.js` | Dark mode and the device preview. |
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

All rights reserved. This repository is source-available: you may read it, run it locally and evaluate it, but copying, modifying, redistributing or using it in your own work needs written permission — see [LICENSE](LICENSE).

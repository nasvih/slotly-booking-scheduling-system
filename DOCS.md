# slotly — technical notes

Architecture, data model, module map, how to extend it, keyboard shortcuts and design tokens.

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
interface and the workflow, not the production system behind them. In practice that means
`createStore` becomes an API client, `staffFree` moves server-side so two receptionists cannot
race for the same slot, and `renderTemplate` hands its output to a message gateway. The views
would not change.

## How this demo works

**You can actually use it.** Every screen writes to the same store. Booking a slot blocks it
on the calendar, puts a token in the Today queue and adds a row to Bookings. Nothing is
read-only.

**Your data stays on your machine.** State lives in `localStorage` under `slotly.v1`. There
is no server, no account, no API, and no application code calls `fetch` — the only one in the
repository is the service worker re-issuing requests the browser already made for this app's
own files. Clearing browser data or pressing
**Reset demo data** re-seeds from scratch. Nothing syncs between browsers or devices.

**The assistant is simulated.** `Slotly Desk` matches your question against local intent
rules and answers with numbers read out of the live store. It is a demonstration of the
interaction, not a connected model, and no request leaves the browser. The panel footer says
so on every screen.

---

## Architecture

One page, hash routed, no build step.

```
index.html
  └── src/main.js                 boot
        ├── createStore('slotly.v1', seedState)      lib/ui.js
        ├── router({today, calendar, …}, onChange)   lib/ui.js
        ├── shell: sidebar + topbar + #viewhost
        ├── initPWA({mount, appName, onNote})        lib/pwa.js → sw.js
        ├── buildAgent(ctx).mount(document.body)     src/agent.js
        └── draw() → VIEWS[current].render(ctx) → Node
```

`main.js` owns a single `ctx` object handed to every view:

| Field | Meaning |
|---|---|
| `ctx.store` | The store returned by `createStore`. Use `ctx.store.update(fn)` to mutate. |
| `ctx.state` | Getter for the current state. Always read through this, never cache it. |
| `ctx.navigate(path)` | Sets `location.hash` to `#/path`. |
| `ctx.refresh()` | Re-renders the current view without touching the store. Used for local view state such as filters. |
| `ctx.params`, `ctx.query` | Extra hash segments and query string, from the router. |

The render loop is deliberately dumb: any `store.update` fires every subscriber, `draw()`
throws the view away and rebuilds it, and the scroll position is restored. There is no
virtual DOM and no diffing. Views hold their own filter state in module-level variables, so
a filter survives a re-render but resets on reload.

Views must be pure builders: `render(ctx) -> Node`. They never write to `document` directly
and never keep a reference to a node across renders.

---

## Data model

One JSON object in `localStorage`. Dates are local calendar keys (`YYYY-MM-DD`), times are
24-hour `HH:MM` strings. Nothing stores a timezone.

### `settings`

| Field | Example | Notes |
|---|---|---|
| `deskName`, `branch` | `Ashwini Care Studio` | Shown in the topbar area and in templates. |
| `openTime`, `closeTime` | `08:30`, `18:00` | Bounds of the calendar grid. |
| `slotMinutes` | `30` | Grid step. A booking block is rounded up to the next step. |
| `closedDays` | `[0]` | Day numbers, `0` = Sunday. |
| `tokenPrefix` | `A` | Token labels render as `A001`. |
| `currency` | `₹` | Never hard-code a symbol in a view. |
| `confirmTemplate`, `reminderTemplate`, `cancelTemplate` | string | `{{placeholder}}` syntax. |

### `services[]`

`id`, `name`, `code`, `durationMin`, `bufferMin`, `priceInr`, `active`.
The **block** a booking occupies is `durationMin + bufferMin`.

### `staff[]`

`id`, `name`, `initials`, `role`, `room`, `active`, `days[]` (0–6), `start`, `end`,
`breakStart`, `breakEnd`, `skills[]` (service ids).

### `customers[]`

`id`, `name`, `phone` (masked), `email`, `since`, `tags[]`, `note`.

### `bookings[]`

| Field | Notes |
|---|---|
| `id`, `ref` | `ref` is the human reference `SL-1234` and survives a reschedule. |
| `date`, `time`, `blockMin` | The reserved window is `[time, time + blockMin)`. |
| `serviceId`, `staffId`, `customerId` | Foreign keys. Missing rows degrade to placeholder objects, never crash. |
| `status` | `booked` · `called` · `serving` · `done` · `no-show` · `cancelled`. |
| `token` | Integer, reassigned per day in slot order by `assignTokens`. |
| `channel`, `note`, `createdAt`, `history[]` | `history` is a capped event log shown in the drawer. |

`cancelled` and `no-show` bookings release their slot; the other four hold it.

### Scheduling functions — all in `src/data.js`

| Function | Answers |
|---|---|
| `gridSlots(state)` | The list of grid times for a day. |
| `isOpenDay(state, key)` | Is the desk open on that date. |
| `staffWorks(state, id, key)` | Is that person rostered that day. |
| `staffFree(state, id, key, start, block, ignoreId)` | Does the block fit the shift, miss the break and hit no booking. `ignoreId` excludes the record being moved. |
| `freeStaffAt(state, key, time, serviceId, ignoreId)` | Who could take that service at that time. |
| `freeSlots(state, key, serviceId, staffId, ignoreId)` | `[{time, staffIds}]` for a whole day. |
| `nextAvailable(state, serviceId, staffId, fromKey)` | First bookable slot within 21 days. |
| `utilisation(state, key)` | Booked minutes against shift minutes, overall and per staff. |
| `customerStats(state, id)` | Visits, no-shows, cancellations, spend, no-show rate. |
| `hourLoad(state, from, to)` | Bookings grouped by opening hour. |
| `deskNowMin(settings)` | Wall-clock minutes clamped into opening hours. Used only to decide what counts as "past". |
| `renderTemplate(tpl, vars)` / `templateVars(state, booking)` | Message rendering. |

`deskNowMin` is the one deliberate fiction: at 11pm the real clock would leave the queue and
today's calendar completely empty, so the app treats "now" as a point inside opening hours.
Dates are never faked, only the time of day.

---

## Module map

| Module | Exports | Used by |
|---|---|---|
| `lib/ui.js` | `h`, `qs`, `qsa`, `on`, `esc`, `money`, `num`, `pct`, `fmtDate`, `fmtTime`, `ago`, `isoDay`, `daysFromNow`, `seeded`, `pick`, `between`, `createStore`, `router`, `toast`, `modal`, `confirmDialog`, `downloadCSV`, `barChart`, `meter`, `icon`, `ICONS` | everything |
| `lib/assistant.js` | `Assistant` | `src/agent.js` |
| `lib/pwa.js` | `initPWA` | `main.js` |
| `sw.js` | — (service worker, registered by `lib/pwa.js`) | the browser |
| `src/data.js` | seed, time helpers, lookups, availability, stats, templates | every view, `agent.js`, `booking.js` |
| `src/booking.js` | `openBooking`, `openReschedule`, `cancelBooking`, `setStatus` | Today, Calendar, Bookings, Customers |
| `src/drawer.js` | `drawer` | Bookings, Customers |
| `src/agent.js` | `buildAgent`, plus the `matchDay` / `matchService` / `matchStaff` / `matchCustomer` parsers | `main.js` |
| `src/views/*.js` | default `render(ctx)` | `main.js` |

### Assistant intents

Twelve intents, each with a regex and keyword match list, a trace line and an `answer(q, state)`
that reads the live store. The engine scores every intent (2 points per regex hit, 1 per
keyword) and runs the best one; below that, four rotating fallbacks say what the agent *can*
answer.

| Intent | Example question |
|---|---|
| `free-slots` | "what is free on Friday for physiotherapy" — rolls forward if that day is closed |
| `next-available` | "next available with Anwar" — plus every other staff member's first opening |
| `queue-now` | "who is waiting right now" |
| `today-load` | "how busy is today" — accepts any parsed day |
| `busiest-hour` | "busiest hour" — 30 days back plus the week ahead |
| `no-show-risk` | "who might not turn up" — or a named customer |
| `staff-load` | "utilisation this week", "what are Nithya's working hours" |
| `service-mix` | "which service earns most" |
| `revenue` | "takings this week" |
| `cancellations` | "cancellations this week" |
| `customer-lookup` | "history for Meera" |
| `desk-setup` | "opening hours", "how long is a slot" |

---

## Extending it

**Add a screen.** Write `src/views/reports.js` exporting `render(ctx) -> Node`, import it in
`src/main.js` and add a row to `VIEWS` with `id`, `label`, `icon` (a key of `ICONS`), `group`,
`title`, `sub`. The router, the nav and the number shortcuts pick it up automatically. Add a
key to `counts()` if you want a badge.

**Add a service or a staff member.** Through the UI, or by editing `seedState()` in
`src/data.js` and pressing **Reset demo data**. Staff colour bars on the calendar come from
`.cal__ev--<staffId>` in `assets/slotly.css`; new ids fall back to the ink border.

**Add an assistant intent.** Push an object onto the array in `intents()`:

```js
{
  id: 'walk-ins',
  match: [/walk.?in/i, 'walk in'],
  trace: 'counted bookings by channel',
  answer: (q, state) => ({ text: `…`, table: { head: [], rows: [] }, suggestions: [] }),
}
```

Read `state` for the numbers, never a captured copy. Order matters when two intents can match
the same sentence — the earlier one wins a tie, so put the more specific intent first or give
it extra keyword matches.

**Change the schedule maths.** Everything routes through `staffFree`. Per-slot capacity above
one, double-booking rules or room constraints all belong there, and every screen inherits them.

**Add a file.** Any new module, stylesheet or icon has to be added to the `SHELL` array in
`sw.js`, or an installed copy will not have it when there is no connection.

**Bump `CACHE_VERSION` whenever anything in `SHELL` changes at all** — not only when the list
does. The browser only reinstalls a worker whose own bytes changed, so editing `main.js` and
leaving `sw.js` alone leaves every returning visitor on the previously cached copy for good.
Changing the version string is what makes `sw.js` differ, which triggers the reinstall, which
re-fetches the shell and drops the old cache in `activate`.

**Never** add a dependency, a build step, a `fetch` call to any host, or a gradient. The only
`fetch` in the repository is inside `sw.js`, and it only ever re-issues a request the browser
already made for one of these files.

---

## Keyboard shortcuts

| Key | Action |
|---|---|
| `1` … `7` | Jump to a section, in nav order: Today, Calendar, Bookings, Services, Staff, Customers, Settings |
| `N` | New booking |
| `/` | Focus the search box on the current screen |
| `⌘K` / `Ctrl+K` | Open the Slotly Desk assistant |
| `Esc` | Close a dialog, drawer or the assistant |
| `?` | Show the shortcut list |

Shortcuts are ignored while typing in an input, a textarea or a select.

## Sidebar footer

Everything that is not a screen lives in the sidebar footer, one click away from anywhere.

| Control | Effect |
|---|---|
| **Reset demo data** | Confirms, then re-seeds `slotly.v1`. Leaves `slotly.ui` alone. |
| **About this demo** | The five-block modal: what this is, where it helps, how it would work for real, how the demo works, and where to read the source. Same content as the `DEMO` pill in the topbar. |
| **nasvih.in** | Link to the author's site. The one inverted control in the footer. |
| **Source on GitHub** | Link to the repository, drawn as an outline control so the inverted one stays unique. The glyph is code brackets in stroke SVG — the GitHub mark is a filled logo and every icon here is a stroke on `currentColor`. |
| **Collapse / Expand** | Toggles `is-rail` on the `.shell` element: a 64px icon rail with labels, group headings and counts hidden. Every nav link keeps a `title` and an `aria-label`, so the rail stays readable to a screen reader and on hover. |
| **White / Yellow** | Toggles `data-tone="amber"` on the `.side` element. The button names the move rather than the state, the way Collapse/Expand does, so the toggle is not signalled by colour alone. |
| **Install app** | Added by `initPWA` and hidden until the browser fires `beforeinstallprompt` (or immediately on iOS, where no such event exists). |

The two toggles use `aria-pressed` and persist in `localStorage` under **`slotly.ui`** — a
separate key from the demo data, so **Reset demo data** does not disturb the chrome. Both
links carry `target="_blank" rel="noopener noreferrer"` and an `aria-label` that says they
open in a new tab. In rail mode every one of these collapses to its icon, with the label
still on `title` and `aria-label`.

### The yellow sidebar is the default

`data-tone="amber"` is applied when **nothing is stored**. Only an explicit press of the
colour control writes `{"tone":"plain"}` and gives the plain white sidebar back, so a fresh
browser always opens yellow. Nothing is written on load — "no stored preference" stays
literally true until the control is used.

`assets/app.css` inks the yellow sidebar: ink `#17181A` on `#EAC81C` is 10.8:1, the brand mark
inverts to an ink tile, quiet text (the tag line, group headings, nav counts) goes to
`--ink-2` at 8:1 rather than `--amber-darker` which falls under AA against the fill, the focus
ring switches from `--amber` — invisible on yellow — to ink, the active row becomes a solid
white card, and the footer buttons sit on a translucent white. **Never white text on yellow.**

`assets/slotly.css` adds only what is this app's own markup:

| Rule | Why |
|---|---|
| `.side[data-tone="amber"] .side__sub` → `--ink-2` | The author line is ours, so it follows the same AA rule as the kit's quiet text instead of staying `--faint` grey on yellow. |
| `.side[data-tone="amber"] .navlink.is-active:hover` pinned to `--bg` | The generic hover tint only muddied the white active card. |
| `.sitelink` on `--night` with white type | The one inverted element in the sidebar. It stands out against yellow without adding a colour that is not already a token, and it still reads on the white sidebar. Hover goes to `--night-2`. |
| `.srclink` with a `--line-2` border | An outline control, deliberately not a second dark one — one inverted element in the footer is a focal point, two is a pattern. On yellow it takes the same translucent white ground as the toggle buttons beside it. |

Both tones and the rail were checked in a browser at 1280px and 390px.

Rail mode is a desktop concern. Under 900px the sidebar is already an off-canvas drawer, so
the `is-rail` class is never applied there (guarded by a `matchMedia('(min-width:901px)')`
check that also re-runs on resize) and the collapse control is hidden by CSS. The open drawer
covers the menu button, so it closes on an outside click and on `Escape` as well as on
navigation.

## Installable (PWA)

Three files, no build step and no dependency.

| File | Job |
|---|---|
| `manifest.webmanifest` | `name`/`short_name` **Slotly**, one-line description, `start_url` and `scope` both `./` so it works from a Pages subdirectory, `display: standalone`, `background_color: #FFFFFF`, `theme_color: #EAC81C`, `lang: en`, categories, and three icons — 192 and 512 as `purpose: "any"`, plus a 512 as `purpose: "maskable"` for Android's shaped icons. |
| `sw.js` | Cache-first service worker over one versioned cache keyed on the registration scope. `install` pre-caches `SHELL`, `activate` deletes every older cache under the same scope and claims open clients, `fetch` serves same-origin assets from cache and falls back to `./index.html` for navigations so a reload works offline. |
| `lib/pwa.js` | Registers the worker on `load`, captures `beforeinstallprompt`, and drives the **Install app** control. |

`index.html` carries `<link rel="manifest">`, `<meta name="theme-color" content="#EAC81C">`,
an `apple-touch-icon` and the `apple-mobile-web-app-*` pair that gives iOS a standalone window
and the right home-screen name.

`main.js` wires it up in one call:

```js
initPWA({ mount: installHost, appName: 'Slotly', onNote: (msg) => toast(msg) });
```

`mount` is an empty `div.side__install` sitting between the sidebar toggles and the author
line, so the button lands beside the other footer controls and the host collapses to nothing
while the button is hidden. `onNote` goes through the app's own `toast`, so the iOS
instructions and the "install dismissed" note look like every other message in the app.

**The `SHELL` array in `sw.js` is the one thing to maintain.** It lists this app's own files
explicitly — `./`, `./index.html`, the manifest, both stylesheets, all three `lib` modules,
all eleven `src` modules and the three icons. `addAll` is atomic: one file that 404s fails the
whole install and the app is then not available offline, and one file left off the list is
simply missing when there is no connection. Add or rename a file, update `SHELL` and bump
`CACHE_VERSION` in the same commit.

The worker never invents a network call — the app has none. The only cross-origin requests are
the Google Fonts stylesheet and its `woff2` files, which the worker caches opportunistically as
they are requested, so an installed copy keeps its typography offline.

## The assistant has exactly one entry point

The round 52px launcher at the bottom right, plus `⌘K` / `Ctrl+K`. There is deliberately no
topbar button, no sidebar item and no in-page link that opens it — the launcher is mounted
once by `bot.mount(document.body)` in `src/main.js`, and `lib/assistant.js` owns its markup,
its accessible name and its glyph.

Accessibility: the sidebar collapses under 900px behind a labelled menu button, every
icon-only button carries an `aria-label`, toggles expose `aria-pressed`, the active nav item
carries `aria-current="page"`, drawers and modals close on `Escape`, and status is always
paired with a word rather than signalled by colour alone.

---

## Design tokens

Defined in `assets/app.css` under `:root`. Use the variable, never the literal.

| Token | Value | Use |
|---|---|---|
| `--bg`, `--surface` | `#FFFFFF` | Page and card ground |
| `--surface-2` | `#FAFAF8` | Table heads, muted cells, log ground |
| `--hover` | `#FEFBEA` | Row and button hover |
| `--ink`, `--ink-2`, `--muted`, `--faint` | `#17181A` → `#686E75` | Text ramp |
| `--line`, `--line-2` | `#E7E7E4`, `#D8D8D3` | Hairlines |
| `--amber`, `--amber-fill` | `#EAC81C` | The brand yellow, **as a fill with ink text** |
| `--amber-deep` | `#8A6D00` | Yellow *text* on white — never `--amber` for type |
| `--amber-soft`, `--amber-line` | `#FEF9DA`, `#F0DE8C` | Selected and accent surfaces |
| `--ok` `--warn` `--bad` `--info` | solid | Status, each paired with `-soft` and `-line` |
| `--r-lg` `--r` `--r-sm` `--r-xs` | 12 / 8 / 6 / 4 px | Radii |
| `--sans` | Inter | UI |
| `--mono` | JetBrains Mono | Labels, numbers, tokens, times, code |

Rules the app holds to: solid colours only — no gradients, no blur, no glow shadows, no emoji
as icons. Icons are inline stroke SVG using `currentColor`, from `ICONS` in `lib/ui.js`.
App-specific CSS lives in `assets/slotly.css` and uses only these tokens; `assets/app.css` is
a verbatim copy of the shared kit and is never edited.

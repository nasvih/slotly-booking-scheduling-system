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

**The assistant also writes.** Seven of its nineteen intents propose a change to the store —
booking, rescheduling, cancelling, running the queue, holding staff time, changing a service —
and apply it when the reader presses the button on the answer. Nothing is ever mutated on the
strength of a sentence alone.

---

## Architecture

One page, hash routed, no build step.

```
index.html
  └── src/main.js                 boot
        ├── applyTheme(readTheme())                  src/chrome.js
        ├── createStore('slotly.v1', seedState)      lib/ui.js
        ├── ensureShape(store.state)                 src/data.js
        ├── router({today, calendar, …}, onChange)   lib/ui.js
        ├── shell: sidebar + topbar + #viewhost
        ├── topbar: mountBell(ctx)                   src/notify.js
        │           deviceControls(), themeToggle()  src/chrome.js
        ├── initPWA({mount, appName, onNote})        lib/pwa.js → sw.js
        ├── buildAgent(ctx).mount(document.body)     src/agent.js + src/actions.js
        └── draw() → VIEWS[current].render(ctx) → Node
```

`index.html` sets `data-theme` in a four-line inline script before the first paint, so the
page never flashes white on the way into dark mode. `src/chrome.js` owns the same
`slotly.theme` key and takes over from there.

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

### `blocks[]`

Time a staff member is held back from booking, written by the assistant's *hold back staff
time* action and released from the staff card.

`id`, `staffId`, `date`, `start`, `end`, `reason`, `at`.

A block is not a booking: it has no customer, no token and no price. It is read by
`staffFree` (so the calendar stops offering those slots) and by `shiftMinutes` (so utilisation
does not count time nobody is available for). States saved by an earlier build have no
`blocks` array at all, which is what `ensureShape(state)` in `src/data.js` is for — `main.js`
runs it on boot and on every store update.

### Scheduling functions — all in `src/data.js`

| Function | Answers |
|---|---|
| `gridSlots(state)` | The list of grid times for a day. |
| `isOpenDay(state, key)` | Is the desk open on that date. |
| `staffWorks(state, id, key)` | Is that person rostered that day. |
| `staffFree(state, id, key, start, block, ignoreId)` | Does the block fit the shift, miss the break, clear any held period and hit no booking. `ignoreId` excludes the record being moved. |
| `blocksOn(state, id, key)` / `blockedMinutes(state, id, key)` | Held periods for one person on one day, and their total. |
| `addBlock(state, {staffId, date, start, end, reason})` | Holds a period back. Called inside a `store.update`. |
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
| `src/data.js` | seed, `ensureShape`, time helpers, lookups, availability, held time, stats, templates | every view, `agent.js`, `actions.js`, `booking.js`, `notify.js`, `token.js` |
| `src/parse.js` | `matchDay`, `matchService`, `matchStaff`, `withStaff`, `matchCustomer`, `bookingCustomer`, `matchTime`, `snapToGrid`, `matchBooking`, `matchWindow`, `matchNumber` | `agent.js`, `actions.js` |
| `src/actions.js` | `actionIntents(ctx)`, `ACTION_EXAMPLES`, `ACTION_CHIPS` | `agent.js`, `main.js` (About modal) |
| `src/token.js` | `openToken(ctx, booking, {title})`, `tokenButton(ctx, booking)` | `booking.js`, `actions.js`, Today, Bookings |
| `src/notify.js` | `buildNotifications(state)`, `mountBell(ctx)` | `main.js` |
| `src/chrome.js` | `readTheme`, `applyTheme`, `themeToggle`, `deviceControls`, `IS_FRAMED`, `THEME_KEY` | `main.js` |
| `src/booking.js` | `openBooking`, `openReschedule`, `cancelBooking`, `setStatus` | Today, Calendar, Bookings, Customers |
| `src/drawer.js` | `drawer` | Bookings, Customers |
| `src/agent.js` | `buildAgent`, plus the parsers re-exported from `parse.js` | `main.js` |
| `src/views/*.js` | default `render(ctx)` | `main.js` |

### Assistant intents

Nineteen intents, each with a regex and keyword match list, a trace line and an
`answer(q, state)` that reads the live store. The engine scores every intent (2 points per
regex hit, 1 per keyword) and runs the best one; below that, four rotating fallbacks say what
the agent *can* answer. The twelve reading intents are declared first, so a tie resolves to
the answer that changes nothing.

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

### Action intents

Seven more, in `src/actions.js`. Each one parses the sentence, names the exact record it read,
and returns a proposal carrying `actions: [{ label, doingLabel, run() }]`. `run()` is the only
thing that touches the store, and only a press calls it. It returns
`{ text, table, meta, suggestions, actions }`, which the panel appends as the agent's next
reply — so a refusal can itself offer a button ("book the nearest free slot instead").

| Intent | Example | What `run()` does |
|---|---|---|
| `act-book` | `book Anwar for physiotherapy tomorrow at 4` | Creates the booking (and the customer, if the name is new), then opens the token slip. |
| `act-move` | `move SL-1042 to Thursday at 11` | Rewrites `date`, `time` and `staffId` in place, keeps `ref`, re-runs `assignTokens`. |
| `act-cancel` | `cancel SL-1043 because the customer is unwell` | Sets `cancelled`, writes the reason onto the note and the history. |
| `act-queue` | `call the next token` · `mark the current one served` · `A012 did not turn up` | One status change on one token. |
| `act-block` | `block Nithya's afternoon tomorrow` | Pushes `blocks[]` rows. With bookings inside the window it refuses, and offers either the free part only or cancelling them first. |
| `act-service` | `make the dental cleaning 30 minutes` · `set the physiotherapy price to 1200` | Writes the service, then retimes the future bookings whose new block still fits. |
| `act-help` | `what can you do?` | Reads nothing, writes nothing — prints `ACTION_EXAMPLES`. |

`ACTION_EXAMPLES` is exported and used twice: by `act-help` and by the **What the assistant can
change** block in the About modal, so the documented examples and the working ones cannot
drift apart.

Three rules every action holds to:

1. **Name the record before changing it.** Every proposal carries an "I read this as" table:
   customer, service, staff, day, time — or booking, from, to.
2. **Refuse rather than guess.** No name, an ambiguous customer with several open bookings, a
   staff member without the skill, a slot already taken, a day that has gone — each gets a
   plain sentence and, where there is one, a concrete alternative as a button.
3. **Report before and after.** Every result table has a `Before` and an `After` column, and
   the change is on screen behind the panel the moment it lands, because `store.update` fires
   `draw()`.

> `run()` is awaited by `lib/assistant.js`, so its result object must never carry a `then`
> property — a plain object with a `then` function is a thenable and the `await` would hang
> forever. Anything that should happen after the reply is queued with `setTimeout` instead.

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

## Sidebar chrome and footer

The two chrome controls sit on the brand row in `.side__brandbtns`, right of the app name.
Both are icon-only — the kit clips their `<span>` and sizes them to 30×30 — so the glyph and
the accessible name have to do all the work.

| Control | Effect |
|---|---|
| **Collapse sidebar / Expand sidebar** | Toggles `is-rail` on the `.shell` element: a 64px icon rail with labels, group headings and counts hidden. `title` and `aria-label` name the action and follow the state; the glyph is a panel with a chevron pointing at the edge the sidebar is about to move to. |
| **Sidebar colour** | Toggles `data-tone="amber"` on the `.side` element. It names no colour in the interface or in the accessible name — the glyph, a circle half filled, carries that, and `aria-pressed` reports whether the yellow tone is on. |

In rail mode `.shell.is-rail .side__brandbtns` stacks the pair into a column under the mark,
so both stay reachable inside 64px. Below 900px the collapse control is hidden in
`assets/slotly.css`, because the sidebar is already a drawer there.

Everything else lives in the footer: two `.side__pair` rows that share their width and truncate
rather than overflow. **About this demo** is not one of them — it is a topbar button now, next
to the demo marker it explains, and having it in both places was one entry point too many.

| Control | Effect |
|---|---|
| **nasvih.in** | Link to the author's site. The one inverted control in the footer. |
| **GitHub** | Link to the repository, drawn as an outline control so the inverted one stays unique. The glyph is code brackets in stroke SVG — the GitHub mark is a filled logo and every icon here is a stroke on `currentColor`. |
| **Install app** | Added by `initPWA` at the head of the last row and hidden until the browser fires `beforeinstallprompt` (or immediately on iOS, where no such event exists). While hidden it leaves the row entirely, so **Reset demo data** spans it alone. |
| **Reset demo data** | Confirms, then re-seeds `slotly.v1`. Leaves `slotly.ui` alone. |

The two chrome controls use `aria-pressed` and persist in `localStorage` under **`slotly.ui`**
— a separate key from the demo data, so **Reset demo data** does not disturb the chrome. Both
links carry `target="_blank" rel="noopener noreferrer"` and an `aria-label` that says they
open in a new tab. In rail mode every footer control collapses to its icon in one column,
with the label still on `title` and `aria-label`.

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
| `.side__pair .navlink:not(.sitelink)` with a `--line-2` border | Everything sharing a paired row reads as a control rather than a nav row, so it takes a hairline — deliberately not a second dark one, because one inverted element in the footer is a focal point and two is a pattern. On yellow they take a translucent white ground. |

Both tones and the rail were checked in a browser at 1280px and 390px.

Rail mode is a desktop concern. Under 900px the sidebar is already an off-canvas drawer, so
the `is-rail` class is never applied there (guarded by a `matchMedia('(min-width:901px)')`
check that also re-runs on resize) and the collapse control is hidden by CSS. The open drawer
covers the menu button, so it closes on an outside click and on `Escape` as well as on
navigation.

## Topbar controls

Left to right: the menu button (under 900px), the section title, then **About this demo**, the
three chrome controls in `.topbar__tools`, and **New booking**. The three are icon-only, inline
stroke SVG on `currentColor`, each with `aria-label` and `title`, each reachable by keyboard.

| Control | Module | Notes |
|---|---|---|
| **Notifications** | `src/notify.js` | `buildNotifications(state)` derives the list from live bookings every time the panel opens — nothing is stored as a message, so it cannot go stale. Five sources: starting within the hour, staff still at the chair past their block, today's no-shows, cancellations in the week ahead, and anyone booked past their shift minutes. Each id encodes the record *and* the state it was in (`over:bk-1042:3`), so a booking that changes becomes a new, unread item. Only the read ids persist, under `slotly.notify`, capped at 300. Unread is a coloured dot **and** the word "New". |
| **Device preview** | `src/chrome.js` | Two buttons with `aria-pressed`. Phone mode appends a fixed `.devstage` over everything at `z-index:90` and puts the app in an `<iframe>` at exactly 390 × 844 inside a 12px ink bezel, scaled to fit with `transform: scale()` on resize. It is an iframe rather than a CSS-shrunk clone so the app's own media queries fire for the honest reason. The framed URL carries `?frame=1`; `IS_FRAMED` reads it and `main.js` leaves the control out of the framed copy. `Escape` and **Back to desktop** both exit. |
| **Dark mode** | `src/chrome.js` | Sets `data-theme="dark"` on `<html>` and writes `slotly.theme`. `readTheme()` falls back to `prefers-color-scheme`, and a `change` listener keeps following the system *until* something is stored — pressing the switch is what opts out. It also updates `<meta name="theme-color">`. |

Both popovers stop the click that opened or repainted them from reaching the document
listener that closes them on an outside click; a repaint detaches the clicked node, which
would otherwise read as "clicked outside". The token slip and the device stage capture
`Escape` and call `stopPropagation`, so one press closes the thing on top and not the
assistant panel behind it.

## The token slip

`src/token.js`. `openToken(ctx, booking, {title})` builds its own scrim at `z-index:78` —
above the drawer (70) and the assistant panel (75), below the toasts (80) so a "saved" message
is still visible over it. `role="dialog"`, `aria-modal`, `aria-labelledby` on the token
number, focus moved to **Download** on open and returned to the opener on close, `Tab` cycled
inside the dialog, `Escape` and the close button and a scrim click all exit.

The slip is `--amber-fill` with `--on-amber` text, and every quiet colour on it is an alpha of
ink rather than a theme token — which is why it looks the same in dark mode. Ink on `#EAC81C`
is 10.8:1.

`drawSlip(data)` paints the same content on an offscreen 1080 × 1350 canvas: solid yellow
ground, inset ink rule, the desk name, the token at 232px mono, the reference, then the five
detail rows, then the footer line. `document.fonts.ready` is awaited first so the canvas gets
Inter and JetBrains Mono rather than a fallback, long values are trimmed with an ellipsis to
the width available, and `canvas.toBlob(…, 'image/png')` feeds an object URL to a temporary
`<a download>`. No library and no network.

`tokenButton(ctx, booking)` is the "show it again" control. It is on every non-cancelled row
in **Today** and **Bookings**, and in the booking drawer, so the slip is never a one-time
thing. `openBooking` opens it after `onDone` has run, so a reschedule prints the reference it
kept rather than the temporary one it was created with.

## Dark mode

`assets/app.css` ships the palette under `[data-theme="dark"]`: surfaces go dark, hairlines
lift, the status colours brighten, and `--amber-fill` and `--on-amber` do not move at all. The
rule that survives the theme is the same one that governs the light build — **the yellow is a
fill and the text on it is ink**.

`assets/slotly.css` adds only the corrections this app's own markup needs. The yellow sidebar
paints its text with `--ink`, which is near-white in dark mode, so every rule that puts type on
`data-tone="amber"` is re-pinned to `--on-amber` (and quiet text to `#3B3D40`, 8.5:1 against
the fill). The active nav row stays a solid white card. The switch knob, the calendar event
bars and the uptime-style strips get the same treatment.

Checked screen by screen at 1280px and 390px in both themes: Today, Calendar, Bookings,
Services, Staff, Customers, Settings, the token slip, the notification panel, the About modal,
the assistant panel and both sidebar tones.

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
initPWA({ mount: installRow, appName: 'Slotly', onNote: (msg) => toast(msg) });
```

`mount` is the last `.side__pair` row in the footer, the one holding **Reset demo data**.
`initPWA` appends, so `main.js` moves the returned control to the head of the row; while the
button is hidden `[hidden]{display:none!important}` takes it out of the flex row entirely and
Reset spans the row on its own, so nothing shifts on browsers that never offer an install.
`onNote` goes through the app's own `toast`, so the iOS instructions and the "install
dismissed" note look like every other message in the app.

**The `SHELL` array in `sw.js` is the one thing to maintain.** It lists this app's own files
explicitly — `./`, `./index.html`, the manifest, both stylesheets, all three `lib` modules,
all seventeen `src` modules and the three icons. `addAll` is atomic: one file that 404s fails the
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

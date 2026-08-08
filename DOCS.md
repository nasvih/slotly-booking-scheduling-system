# slotly — technical notes

Architecture, data model, module map, how to extend it, keyboard shortcuts and design tokens.

---

## What this demo is

**You can actually use it.** Every screen writes to the same store. Booking a slot blocks it
on the calendar, puts a token in the Today queue and adds a row to Bookings. Nothing is
read-only.

**Your data stays on your machine.** State lives in `localStorage` under `slotly.v1`. There
is no server, no account, no API. `fetch` is never called. Clearing browser data or pressing
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

**Never** add a dependency, a build step, a `fetch` call or a gradient.

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

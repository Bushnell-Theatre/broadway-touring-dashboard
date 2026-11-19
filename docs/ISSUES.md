# BTD — Issue Tracker

Known defects, structural risks and cleanup work, with the evidence that proves
each one. This is the durable list: if an issue is not in here, it will be lost.

**Treat the severity and sequencing as a draft.** They are an engineering read.
Anything that changes what a programmer sees on screen is a Bushnell decision,
not a code decision.

## How to use this file

- **IDs are permanent.** `BTD-007` means the same thing forever. Never renumber,
  never reuse. New issues take the next free number, whatever their severity.
- **Status is the only field that routinely changes.** Move an entry to
  *Resolved* when it ships, keeping its ID, and record the commit sha.
- **One entry, one defect.** If a fix splits into two, give the second a new ID
  rather than widening the first.
- Add the evidence — the command, the output, the file and line. An entry
  nobody can reproduce is a rumour.

| Status | Meaning |
|---|---|
| `Open` | Confirmed, nobody is on it |
| `In progress` | Being worked now |
| `Needs decision` | Blocked on a Bushnell call, not on engineering |
| `Resolved` | Shipped — moved to the bottom section with its commit |
| `Won't fix` | Deliberately accepted, with the reason recorded |

---

## Open issues

| ID | Sev | Status | Issue |
|---|---|---|---|
| [BTD-001](#btd-001) | P1 | Open | `The Band's Visit` splits into two families — 40 records hidden |
| [BTD-002](#btd-002) | P1 | Open | `BOOP!` tryout and tour are separate families |
| [BTD-003](#btd-003) | P1 | Open | `familyKey` cannot strip hyphenated run markers — Cirque Dreams 2025 A/B lost |
| [BTD-004](#btd-004) | P1 | Open | No detector for new split titles; `title_aliases.json` is hand-maintained |
| [BTD-005](#btd-005) | P1 | Needs decision | `concurrent` is all-or-nothing, so `capDelta`'s comparison partner is sort order |
| [BTD-006](#btd-006) | P1 | Needs decision | No minimum-sample guard on `capDelta` |
| [BTD-007](#btd-007) | P2 | Open | 51 functions duplicated across the two pages, 21 byte-identical |
| [BTD-008](#btd-008) | P2 | Open | `context.json` fetched from the hardcoded production URL first |
| [BTD-009](#btd-009) | P2 | Won't fix (for now) | ESLint cannot see cross-`<script>` references |
| [BTD-010](#btd-010) | P3 | Open | `src/js/core/data.js` loaded on every page, never called |
| [BTD-011](#btd-011) | P3 | Open | Four data files unreachable, including `awards.json` at 1.7 MB |
| [BTD-012](#btd-012) | P3 | Open | Six Planning Signal inputs permanently `"Unknown"` |
| [BTD-013](#btd-013) | P3 | Open | Five empty `catch (e) {}` blocks swallow failed data loads |
| [BTD-014](#btd-014) | P3 | Open | 1 lint error + 24 unused-variable warnings |
| [BTD-015](#btd-015) | P4 | Open | Primary navigation is not keyboard reachable |

### Suggested order

1. **BTD-001, BTD-002** — two JSON lines fixes two titles today
2. **BTD-003, BTD-004** — the structural gap and the detector that catches the next one
3. **BTD-005 + BTD-006** — decide together what a `capDelta` is allowed to compare
4. **BTD-008** — reverse the fetch order; removes the smoke-suite allowlist too
5. **BTD-010, BTD-011, BTD-012** — one deprecation pass, box-office style
6. **BTD-007** — lift the 21 identical functions to `page-common.js`
7. **BTD-013, BTD-014**, then **BTD-015**

BTD-001 through BTD-004 are the ones that change what a programmer reads off
the screen.

---

# P1 — Numbers on screen are wrong or arbitrary

Same class as the SIX/MJ bug ([BTD-000](#btd-000), fixed in `63bcdcb`): the page
shows a confident figure that is not what it claims to be.

<a id="btd-001"></a>
## BTD-001 — `The Band's Visit` splits into two families

**Severity** P1 · **Status** Open · **Area** `src/js/core/cycles.js`, `src/data/title_aliases.json`

The feed carries two spellings. `norm()` turns the apostrophe into a space, so
the stems differ and `familyKey` builds two families:

```
familyKey("The Band's Visit") -> "the band s visit"    32 records, 2019-07-21..2020-03-08
familyKey("The Bands Visit")  -> "the bands visit"     40 records, 2021-10-24..2022-07-31
```

Tour History shows **31 weeks**. The entire 2021‑22 run is invisible — more than
half the title's touring record.

**Fix.** One line in `title_aliases.json`.

<a id="btd-002"></a>
## BTD-002 — `BOOP!` tryout and tour are separate families

**Severity** P1 · **Status** Open · **Area** `src/data/title_aliases.json`

```
familyKey("BOOP! The Betty Boop Musical Pre") -> "boop the betty boop musical"   4 records
familyKey("BOOP! The Musical")                -> "boop the musical"              6 records
```

The tour reads 4 weeks. Because the tryout lands in a different family, the
`isPre` skip logic in `cyclesFor` never fires for it — the exact case that logic
exists to handle. `cycles.js` even uses this title as its worked example of a
tryout in the module header.

**Fix.** One line in `title_aliases.json`.

<a id="btd-003"></a>
## BTD-003 — `familyKey` cannot strip hyphenated run markers

**Severity** P1 · **Status** Open · **Area** `src/js/core/cycles.js`

`cycleKey` has `HYPHEN_RUN` to peel off ` 2024-Old Max`. `familyKey` has only
`CYCLE_MARKER`, which does not match a hyphenated run. So:

```
familyKey("Cirque Dreams Holidaze 2025 - A") -> "cirque dreams holidaze 2025 a"
familyKey("Cirque Dreams Holidaze 2025 - B") -> "cirque dreams holidaze 2025 b"
familyKey("Cirque Dreams Holidaze 2025")     -> "cirque dreams holidaze"
```

Both 2025 companies (5 records) are missing from the family entirely.

Grinch's hyphenated runs only work because every single one was hand-aliased.
That is the gap papering over itself — the alias file is absorbing a parsing
limitation one title at a time, and Cirque Dreams is the one nobody caught.

**Fix.** Teach `familyKey` the same marker shapes `cycleKey` already knows. Run
the 143-family before/after diff harness against the change — it caught a
Hamilton regression during the BTD-000 work and would catch this class again.

<a id="btd-004"></a>
## BTD-004 — No detector for new split titles

**Severity** P1 · **Status** Open · **Area** `scripts/`

`title_aliases.json` is hand-maintained with nothing watching it. BTD-001
through BTD-003 were wrong for as long as the feed has carried both spellings,
and were found only by writing a throwaway detector during the 19 Nov audit.

The feed will keep renaming titles. This needs to be a weekly check, not an
audit finding.

**Fix.** A script in `scripts/` that flags family pairs with high token overlap
and adjacent or overlapping date ranges. The throwaway version was noisy —
token overlap on "the musical" produced roughly 45 false pairs that had to be
filtered by hand. A real one should weight rare tokens and require the date
ranges to be adjacent, not merely similar.

<a id="btd-005"></a>
## BTD-005 — `concurrent` is all-or-nothing, so the comparison partner is sort order

**Severity** P1 · **Status** Needs decision · **Area** `src/js/core/cycles.js`

```js
var concurrent = cycles.length > 1 && overlaps === cycles.length - 1;
```

A family with sequential history *and* one concurrent period reads as fully
sequential. Grinch has 1 overlapping pair out of 6, so `concurrent: false`, and
the delta chain runs anyway.

Actual output for the Grinch 2025 cycle:

| Compared against | capDelta |
|---|---|
| Young Max (5w) — **what ships today** | **−10.7** |
| Old Max (7w, ran longer) | −8.5 |
| Both companies pooled | −9.4 |

`lastTour` is whichever of two simultaneous companies sorted last. A 2.2-point
swing is decided by array order and presented to a programmer as a measurement.

**Needs a decision, not a fix.** When two companies run at once, what should the
next cycle be compared against — the pooled average, the longer run, or nothing
at all? Each is defensible. Encoding the wrong one is worse than the current
state, because it would look deliberate.

<a id="btd-006"></a>
## BTD-006 — No minimum-sample guard on `capDelta`

**Severity** P1 · **Status** Needs decision · **Area** `src/js/core/cycles.js`

Same Grinch chain: `2024-Old Max` (7 active weeks) is scored **−11.9** against
`2023-A`, which has **one** active week. A single week of capacity drives a
twelve-point swing, with nothing on the row to say so.

**Needs a decision.** Either suppress the delta below a floor, or show it with
the sample size attached. Worth settling alongside BTD-005 — both are the same
question: what is this number allowed to compare?

---

# P2 — Structural risk

<a id="btd-007"></a>
## BTD-007 — 51 functions duplicated across the two pages

**Severity** P2 · **Status** Open · **Area** `src/exec_summary.html`, `src/programming.html`

21 are byte-identical — 290 lines of straight copy. 30 have drifted.

Identical copies include `renderSignalCard` (93L), `renderTableBody` (42L),
`renderDataTable` (34L), `_buildSeasons` (22L), `sortBy` (13L), `rankItems`,
`median`, `toggleSidebar`, and all five `setX` filter setters.

`tourHistoryHtml` carries a comment saying the two copies "must not diverge" —
and they already have. `programming.html` has a margin change and an explanatory
comment that `exec_summary.html` never received. Cosmetic this time. Nothing
enforces it, so next time it may not be.

**Fix.** The 21 identical ones move to `page-common.js` with no behavioural
risk. Highest-value, lowest-risk slice of the Phase 2 inline-JS extraction, and
it shrinks the surface the Golden Rule has to protect.

<a id="btd-008"></a>
## BTD-008 — `context.json` fetched from the hardcoded production URL first

**Severity** P2 · **Status** Open · **Area** `src/exec_summary.html:1973`, `src/programming.html:1152`

```js
fetch('https://white-pebble-01710020f.7.azurestaticapps.net/data/context.json')
  .catch(() => fetch('data/context.json'))
```

Three consequences:

1. Every local page load makes a cross-origin request that fails, then falls
   back. That is the console error the smoke suite has to allowlist.
2. Any second deployment — a staging slot, a new SWA, a custom domain — would
   silently display **production** context data instead of its own.
3. The hostname is hardcoded in four places; a domain change breaks it.

**Fix.** Relative first, absolute as fallback. One-line reversal per page.
Delete the matching entries from `IGNORED_ERRORS` in `test/smoke/pages.spec.js`
in the same change — they are commented as temporary and this is what they were
waiting on.

<a id="btd-009"></a>
## BTD-009 — ESLint cannot see cross-`<script>` references

**Severity** P2 · **Status** Won't fix (for now) · **Area** `eslint.config.mjs`

`no-undef` is off for HTML files — the honest compromise for the `window.X = ...`
plus bare-call pattern, which ESLint cannot resolve across `<script>` blocks.

The cost: a typo'd function name anywhere in ~12,000 lines of inline JS is
invisible to lint and surfaces only as a runtime console error. The Playwright
smoke suite is the only thing that would catch it, and only on the paths it
exercises.

**Accepted deliberately.** Not fixable without the inline extraction (BTD-007).
Recorded so the blind spot is known rather than assumed away. Revisit when
BTD-007 lands.

---

# P3 — Dead code and dead data

<a id="btd-010"></a>
## BTD-010 — `src/js/core/data.js` is loaded on every page and never called

**Severity** P3 · **Status** Open · **Area** `src/js/core/data.js`

202 lines. Script-tagged in `dashboard.html:26`, `exec_summary.html:31`,
`programming.html:26`. **Zero references to `BTD.data.*` exist anywhere in the
codebase.** Each page does its own inline fetching instead.

Parent of BTD-011 and BTD-012 — both follow from this file being unreachable.

<a id="btd-011"></a>
## BTD-011 — Four data files are unreachable

**Severity** P3 · **Status** Open · **Area** `src/data/`

Consequence of BTD-010.

| File | Size | Referenced by |
|---|---|---|
| `awards.json` | 1.7 MB | `config.js` + the dead `data.js` only |
| `shows.json` | 69 KB | same |
| `media_signals.json` | 274 B | same — and `records: []`, empty since 2026‑08‑14 |
| `media_sources.json` | 233 B | **nothing at all** |

The pipeline behind them still runs on demand: `build_awards.py`,
`build_media_signals.py`, `scrape_shows.py`, and three `update_all.py` steps.

The weekly watcher is unaffected — it publishes only the six live files.

<a id="btd-012"></a>
## BTD-012 — Six Planning Signal inputs are permanently `"Unknown"`

**Severity** P3 · **Status** Open · **Area** `src/js/core/signals.js:18`

Consequence of BTD-010. `signals.js` reads `state.showIndex`, which is set only
in the dead `data.js`. So `showMetaFor()` always returns `{}`, making these
constant:

`recognition`, `press_awareness`, `tour_viability`, `reputation_risk`,
`audience_fit`, `local_market`

**They are not displayed.** `signalRow` renders only demand / revenue / peer /
confidence, and no page reads `profile.awards` or `profile.showMeta`. So this is
dead computation, not a wrong number on screen.

**Decision needed as part of the fix.** This is the box office situation again:
a built feature that was wired out. Either reconnect it deliberately or
deprecate it the same way — but it should not sit half-alive.

<a id="btd-013"></a>
## BTD-013 — Five empty `catch (e) {}` blocks swallow failed data loads

**Severity** P3 · **Status** Open · **Area** `src/programming.html`

Lines 1133, 1143, 1150, 1163, 1171 — all in the `context.json` /
`factsheets.json` fetch block. A failed load produces no warning; the panel just
renders empty and the user has no way to tell a network failure from no data.

**Fix.** A `console.warn` with the file name at minimum. Touches the same block
as BTD-008 — worth doing in that change.

<a id="btd-014"></a>
## BTD-014 — One lint error and 24 unused-variable warnings

**Severity** P3 · **Status** Open · **Area** repo-wide

- `no-useless-assignment` — `src/js/core/dashboard-analytics.js:165`
- 24 unused-variable warnings. The ones worth checking before deleting:
  `signals.js:145 'peers'` and `programming.html:1719 'shows'` — confirm nothing
  was meant to use them.

The other five lint errors are BTD-013.

---

# P4 — Accessibility

<a id="btd-015"></a>
## BTD-015 — Primary navigation is not keyboard reachable

**Severity** P4 · **Status** Open · **Area** all three pages

Nav tabs are `<div class="nav-tab" onclick="showTab(...)">` — no `tabindex`, no
`role="tab"`, no key handler. 30 click handlers across the three pages sit on
non-interactive elements (`div`, `tr`, `td`).

Across all three pages: 15 `tabindex`, 15 `role=`, 126 `aria-` attributes. Some
accessibility work was done; it did not reach the main navigation.

Low urgency for a wall display. Blocking for anyone using a keyboard or screen
reader. The fix is small — `role="tab"`, `tabindex="0"`, Enter/Space handler —
and must be applied identically to all pages per the shared-pattern rule in
CLAUDE.md.

---

# Resolved

<a id="btd-000"></a>
## BTD-000 — A feed rename split one company into two cycles

**Resolved** 17 Nov 2026 · `63bcdcb` · `src/js/core/cycles.js`

`cyclesFor` grouped on the raw feed string, so a mid-run rename produced two
cycles and a cycle-over-cycle delta comparing a company against itself.

- `Six (Boleyn)` → `SIX: The Musical (Boleyn)` showed as two versions with a
  bogus −5.8 delta. Now one run, 162 weeks.
- `MJ` / `MJ The Musical` split the same way, −4.1. Now one run, 136 weeks.

Fixed by adding `cycleKey()`, which strips run markers, aliases the stem, then
reattaches the markers as the distinguishing part. Guarded by
`scripts/test_cycles.js` (24 assertions), which includes a section covering the
Hamilton collapse the first version of the fix nearly introduced.

This is the issue that prompted the 19 Nov audit and the rest of this register.
BTD-001 through BTD-004 are the same defect class, still live.

---

*Register opened 19 November 2026 against `dev` @ `63bcdcb`.
Health at that point: `npm test` 213 assertions PASS, `npx playwright test` 10/10
PASS, `npm run lint` 6 errors / 24 warnings, no inline `@media` outside `print`,
`versions.json` consistent with CLAUDE.md.*

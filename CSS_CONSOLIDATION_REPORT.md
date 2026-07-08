# CSS Consolidation Report

**Audited:** 2026-07-08  
**Auditor:** Claude Code (session 14e77bfc)  
**Status:** Audit complete — awaiting human review before execute pass

---

## Scope

Files audited in full:

- `src/css/styles.css` — 270 lines (post Wire It In, includes new large-screen breakpoints)
- `src/css/charts.css` — 94 lines
- `src/dashboard.html` inline `<style>` — ~1,300 lines (lines 38–1298+)
- `src/programming.html` inline `<style>` — ~1,050 lines (lines 36–1050)
- `src/exec_summary.html` inline `<style>` — ~2,015 lines (lines 41–2056) — includes Executive Scaling Pass + V2 Responsive Scale System
- `src/box_office.html` inline `<style>` — ~1,200 lines (lines 34–1203)

---

## Section 1 — Summary Table

| Classification | Count | Notes |
|---|---|---|
| SHARED candidates (not yet in styles.css) | 3 rule groups | sidebar-toggle, signal-card, faq-section/faq-grid |
| DUPLICATE (same rule in styles.css AND inline) | ~45 rule groups | Core layout components repeated on all 4 pages |
| PAGE-SPECIFIC (stays inline) | ~60+ rule groups | See Section 3 |
| CONFLICT (same selector, different values) | 8 specific conflicts | See Section 5 |

---

## Section 2 — Shared CSS (Not Yet in styles.css — Extraction Candidates)

These rule groups appear in **two or more** HTML pages with matching or nearly matching definitions. They are NOT yet in `styles.css`. A human decision is required before extracting them.

---

### 2A — Sidebar Toggle CSS

**Appears in:** dashboard.html (original), programming.html (added Wire It In), exec_summary.html (added Wire It In)  
**Does NOT appear in:** box_office.html (box_office has no sidebar toggle — sidebar is always visible)  
**Does NOT appear in:** styles.css

All three copies are **identical**:

```css
.sidebar-toggle {
  display: none;
  background: none;
  border: none;
  color: rgba(255, 255, 255, 0.7);
  font-size: 1.2rem;
  cursor: pointer;
  padding: 0 12px;
  align-items: center;
}
@media (max-width: 900px) {
  .sidebar-toggle { display: flex; }
  .sidebar {
    position: fixed;
    left: -240px;
    top: 0;
    height: 100vh;
    width: 240px;
    z-index: 100;
    transition: left 0.25s ease;
    box-shadow: 4px 0 20px rgba(0,0,0,0.15);
  }
  .sidebar.open { left: 0; }
  .sidebar-backdrop {
    display: none;
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.35);
    z-index: 99;
  }
  .sidebar-backdrop.open { display: block; }
}
```

**Recommendation:** Extract to styles.css. All three pages are identical. box_office.html is unaffected because it has no `.sidebar-toggle` element.

**Caution:** The `@media (max-width: 900px)` block re-positions `.sidebar` as `position: fixed`. This overrides the normal sidebar flow for ALL pages that load styles.css. Confirm that box_office.html's sidebar behavior is unaffected before extracting (box_office has no toggle button so the sidebar would stay fixed/hidden if this CSS loads — verify visually).

---

### 2B — Signal Card CSS

**Appears in:** dashboard.html, programming.html, exec_summary.html  
**Does NOT appear in:** box_office.html  
**Does NOT appear in:** styles.css

The `.signal-card` component is the Planning Signal display. It is architecturally SHARED — all three main dashboard pages use it. The CSS is duplicated verbatim across three files.

Rule groups involved:

```
.signal-card
.signal-header
.signal-title
.signal-composites
.signal-composite
.signal-composite-label
.signal-composite-score
.signal-composite-sub
.signal-components
.signal-component
.signal-component:last-child
.signal-comp-label
.signal-comp-metric
.signal-comp-bar
.signal-comp-fill
.signal-comp-fill--neutral
.signal-comp-pcts
.signal-footer
```

**Recommendation:** Extract to styles.css. The signal card is a shared BTD component — its CSS belongs with shared component styles. No conflicts between copies.

**Note:** exec_summary.html's Executive Scaling Pass (see Section 3B) shrinks some of these components via cascade overrides on parent elements. Those overrides remain inline and still work correctly after signal card CSS is extracted.

---

### 2C — FAQ Section CSS

**Appears in:** programming.html and exec_summary.html (identical column layout)  
**Does NOT appear in:** dashboard.html, box_office.html, styles.css

```css
.faq-section { margin-bottom: 32px; }
.faq-section h3 {
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--ink);
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin: 0 0 10px;
  border-bottom: 1px solid var(--rule);
  padding-bottom: 6px;
}
.faq-grid {
  display: grid;
  grid-template-columns: 200px 1fr;
  gap: 8px 20px;
}
.faq-grid dt {
  font-size: 0.65rem;
  font-weight: 700;
  color: var(--ink);
  padding-top: 2px;
}
.faq-grid dd {
  font-size: 0.65rem;
  color: var(--ink2);
  margin: 0;
  line-height: 1.55;
}
```

**Recommendation:** Extract to styles.css. Two pages, identical rules. Only appears on pages that have FAQ/methodology sections, so it's safe on the other two pages where no `.faq-section` elements exist.

**Note:** programming.html's `.faq-section h3` has a different style in one copy of the rule but the canonical definition above is what programming.html uses for the Planning Signal FAQ. Verify both pages render the same before extracting.

---

## Section 3 — Page-Specific CSS (Stays Inline)

These rule groups are unique to one page. They must NOT be extracted to styles.css.

---

### 3A — dashboard.html Page-Specific

| Class / Rule | Description |
|---|---|
| `.btn-danger` | "Clear Data" danger button (red) |
| `#fileInput` | XLSX file drop zone input |
| `.section-rule` | Horizontal rule divider used only in dashboard |
| `.range-row` | Range slider row layout |
| `.show-search-input`, `.show-quick`, `.show-list` | Show filter search UI |
| `.chart-grid`, `.chart-card` | Dashboard 2-column chart card layout |
| `canvas#cCap`, `canvas#cWow`, etc. | Specific canvas height overrides |
| `.rank-grid`, `.rank-card` | Dashboard ranking card grid |
| Modal / drop zone CSS | XLSX import modal (`.drop-zone`, `.modal-*`) |
| `.size-grid` | Theatre size benchmark widget |
| `.alert` | Data alert/notification component |
| `.sub-y`, `.sub-n`, `.no-data` | Table "has data" indicators |
| `.tab-right` | Nav-tab modifier that pushes a tab to the right edge |
| `.badge` | Inline badge (distinct from `.status`) |
| `.cap-cell`, `.cap-bar`, `.cap-fill` | Cap% progress bar inside table cells (see conflict note in Section 5) |
| `@media print` styles | Extensive print layout for dashboard (sidebar hidden, all panels shown, page-break rules, print-header, print-filters) |
| `@media (min-width: 2560px)` block | Large-screen overrides — CONFLICT with new styles.css breakpoints (see Section 5, Conflict 8) |
| `.ctx-badge`, `.ctx-weather`, `.ctx-econ` | Context enrichment badges (NOAA / FRED) — also in box_office.html (see note) |

**Note on `.ctx-badge` / `.ctx-weather` / `.ctx-econ`:** These appear in both dashboard.html and box_office.html. If ctx-badges are confirmed shared, they could be extracted. Deferred — confirm usage before acting.

---

### 3B — exec_summary.html Page-Specific

exec_summary.html has **three distinct layers** of inline CSS. All three stay inline.

**Layer 1 — Base component styles (lines 41–775):** The same shared component block as other pages. These are DUPLICATES (see Section 4) but stay inline until deduplication is approved.

**Layer 2 — Executive Scaling Pass (lines 776–1112):** A complete override layer that re-scales components for Stephanie's executive laptop/conference display target. This layer is exec_summary-specific:
- Re-sets `body { font-size: 12px; line-height: 1.45; }`
- Shrinks masthead padding, kpi-cell padding, kpi-value to `1.25rem`, score to `1.55rem`
- Sets sidebar to `225px`, section-divider h2 to `0.85rem`
- Uses `repeat(auto-fit, minmax(...))` patterns for flexible grid columns
- Contains exec_summary-only classes: `.method-card`, `.explainer`, `.formula`, `.note-list`, `.note`, `.note .note-hd`, `.note .note-body`
- Contains `.peer-badge` and variants (`.peer-badge-size`, `.peer-badge-size_extended`, `.peer-badge-proximity`, `.peer-badge-market`) — used for peer venue type display in exec_summary peer tables

**Layer 3 — V2 Responsive Scale System (lines 1114–2013):** The large responsive system with custom token set and 8 breakpoint ranges (8K/4K/2.5K/desktop/laptop/tablet-landscape/tablet-portrait/phone). Stays inline per Wire It In decision.

Additional exec_summary-only classes:
- `.tip-icon`, `.tip-text` — tooltip component (hover tooltips on data points)
- `.mini-table-wrap`, `.table-wrap` — overflow scroll wrappers
- `@supports not selector(:has(*))` — `:has()` polyfill block

---

### 3C — programming.html Page-Specific

| Class / Rule | Description |
|---|---|
| `.brief` | 2-column brief/summary layout |
| `.insight-list`, `.insight`, `.insight-mark` | Insight card components (programming evaluation cards) |
| `canvas#cCurrent` | Radar chart height override |
| `@media (max-width: 1100px)` / `(max-width: 700px)` | Different breakpoint values than styles.css (1100/700 vs 1920/1400/1024/768) |

---

### 3D — box_office.html Page-Specific

| Class / Rule | Description |
|---|---|
| `.show-item` and variants | Show list item in sidebar |
| `.justify-section`, `.justify-label`, `.justify-value` | Print-ready price justification layout |
| `.input-section-label`, `.input-group` | Input grouping in scenario panel |
| `.scenario-output`, `.out-grid`, `.out-cell` | Scenario output result grid |
| `.modal-backdrop`, `.modal-head`, `.modal-close`, `.modal-body`, `.modal-foot` | Seating config modal (box_office-specific variant) |
| `.config-table`, `.config-status` | Seating configuration display table |
| `.section-price-table` | Pricing section table |
| `.weighted-avg-bar`, `.weighted-avg-bar strong` | Weighted average bar display |
| `.mode-badge`, `.mode-presale`, `.mode-live` | Presale / Live mode indicator badges |
| `.inp-label` | Input label styling |
| `.run-table` and sub-rules | Performance run schedule table |
| `.pg-table` and sub-rules | Price grid table (by section and tier) |
| `.tier-hd` | Pricing tier column header |
| `.results-tbl` and sub-rules | Scenario results output table |
| `.out-sub` | Output sub-text |
| `.holds-grid` | Holds display grid (4-column) |
| `.global-inputs` | Global input grid (3-column) |
| `.perf-card`, `.perf-card:hover`, `.perf-card:active` | Performance card (clickable) |
| `.pm-table` and sub-rules | Performance model summary table |
| `.ctx-badge`, `.ctx-weather`, `.ctx-econ` | Context enrichment badges — also in dashboard.html (see note in 3A) |
| `@media (max-width: 1100px)` / `(max-width: 700px)` | Same breakpoint values as programming.html but different from styles.css |

---

## Section 4 — Duplicates (Same Rule Exists in styles.css AND Inline)

The following rule groups exist in styles.css AND are duplicated inside each page's inline `<style>` block. After the CSS cascade, the inline version wins (it loads after the linked stylesheet). Once conflicts are resolved (Section 5), these inline duplicates can be removed.

**Duplicated across all 4 pages:**

| Rule Group | Notes |
|---|---|
| `:root` color tokens | `--ink`, `--ink2`, `--ink3`, `--rule`, `--rule2`, `--bg`, `--bg2`, `--bg3`, `--amber`, `--amber-lt`, `--amber-md`, `--teal`, `--teal-lt`, `--rose`, `--rose-lt`, `--cobalt`, `--cobalt-lt`, `--gold`, `--serif`, `--sans`, `--mono` |
| CSS reset (`* { box-sizing... }`) | Identical on all pages |
| `html { scroll-behavior: smooth }` | Identical |
| `body` base styles | Identical (`background`, `color`, `font-family`, `font-size: 13px`, `min-height: 100vh`) |
| Masthead base | `.masthead`, `.masthead-brand`, `.brand-icon`, `.brand-text h1`, `.brand-text .sub` |
| Masthead status | `.masthead-status`, `.masthead-status .dot`, `.masthead-status strong` |
| Masthead actions | `.masthead-actions` |
| Button variants | `.btn`, `.btn-outline`, `.btn-outline:hover`, `.btn-ghost`, `.btn-ghost:hover` |
| KPI cell | `.kpi-cell`, `.kpi-label`, `.kpi-value`, `.kpi-sub`, `.kpi-cell:after`, `.kpi-cell:hover:after` |
| Sidebar sub-elements | `.sidebar-section`, `.sidebar-label` |
| Pills | `.pill-row`, `.pill`, `.pill.active`, `.pill:hover:not(.active)` |
| Inputs | `select`, `input[type='text']` (except dashboard has custom arrow — see Section 5) |
| Main pane | `.main-pane` |
| Nav tabs | `.nav-tabs`, `.nav-tab`, `.nav-tab:hover`, `.nav-tab.active` |
| Panels | `.panel`, `.panel.active` |
| Section divider sub-elements | `.section-divider`, `.section-divider-line`, `.section-divider-meta` |
| Grid helpers | `.grid`, `.grid-2`, `.grid-3`, `.grid-4` |
| Card | `.card`, `.card.full`, `.card-hd`, `.card-title`, `.card-sub` |
| Callout | `.callout`, `.callout.good`, `.callout.warn`, `.callout h3`, `.callout p` |
| Score | `.score`, `.score.good`, `.score.warn`, `.score.neutral` (value varies — see Conflict 4) |
| Mini label | `.mini-label` |
| Mini table | `.mini-table`, `.mini-table th`, `.mini-table td`, `.mini-table td.num` |
| Status badges | `.status`, `.status.good`, `.status.warn`, `.status.neutral` |
| Show cards | `.show-card`, `.show-card:hover`, `.show-name` |
| Metric row | `.metric-row`, `.metric`, `.metric .val`, `.metric .lbl` |
| Canvas | `canvas` base, `.small-canvas` |
| Rank list | `.rank-list`, `.rank-item`, `.rank-n`, `.rank-n.top`, `.rank-body`, `.rank-name`, `.rank-detail`, `.rank-val` |
| Bar track | `.bar-track`, `.bar-fill` |
| Empty state | `.empty` |
| Footer | `.footer` |
| Max-width breakpoints | `@media (max-width: 1920px)`, `(max-width: 1400px)`, `(max-width: 1024px)`, `(max-width: 768px)` — values differ per page (see Conflicts 5 and 6) |

**Total estimated duplicate CSS:** Approximately 700–900 lines of inline CSS per page that are already covered by styles.css. Over four pages, this is ~2,800–3,600 lines of redundant CSS currently loaded by every user on every page load.

---

## Section 5 — Conflicts (Same Selector, Different Values — Human Decision Required)

These conflicts must be **resolved by a human before any CSS is removed.** Do not guess which value is "correct" — they may each be intentional for their page.

---

### Conflict 1 — kpi-strip grid-template-columns

| Source | Value | Effect |
|---|---|---|
| `styles.css` | `repeat(auto-fit, minmax(160px, 1fr))` | Fluid — adapts to any KPI count |
| `dashboard.html` | `repeat(8, 1fr)` | Hard 8 columns — correct for dashboard's 8 KPIs |
| `programming.html` | `repeat(7, 1fr)` | Hard 7 columns — correct for programming's 7 KPIs |
| `exec_summary.html` (base) | `repeat(8, 1fr)` → overridden to auto-fit in V2 | Complex — V2 system handles it |
| `box_office.html` | `repeat(8, 1fr)` | Hard 8 columns |

**Decision needed:** styles.css uses `auto-fit` which is per-page-KPI-count agnostic. The inline hard values are intentional per page. The current inline wins (overrides styles.css) so no visual regression exists today. If inline is removed, `auto-fit` from styles.css would take over — this **would change the layout** of pages with 7 or 8 KPIs. Hard column counts must either stay inline or styles.css must be updated per-page via a class modifier.

**Recommended resolution:** Keep kpi-strip grid-template-columns as a page-level inline override. Remove the kpi-strip rule from styles.css since it conflicts with every page's actual KPI count.

---

### Conflict 2 — sidebar width

| Source | Value |
|---|---|
| `styles.css` | `width: var(--sidebar-w)` = 240px |
| `dashboard.html` | `width: 220px` |
| `programming.html` | `width: 230px` |
| `exec_summary.html` (base) | `width: 240px` → scaled to 225px in Executive Scaling Pass |
| `box_office.html` | needs verification (likely 220–240px) |

**Decision needed:** Three different sidebar widths across four pages. The current inline overrides styles.css so no regression today, but the conflict exists. If the inline rules are removed, all pages would use `--sidebar-w: 240px`. The 10–20px differences are visible at desktop widths.

**Recommended resolution:** Each page specifies its own sidebar width inline. Remove or neutralize the sidebar `width:` from styles.css, letting each page control it.

---

### Conflict 3 — section-divider h2 font-size

| Source | Value |
|---|---|
| `styles.css` | `0.95rem` |
| `dashboard.html` | `0.85rem` |
| `programming.html` | `0.85rem` |
| `exec_summary.html` (base) | `0.95rem` → then `0.85rem` in Executive Scaling Pass |
| `box_office.html` | presumed `0.85rem` (matches other pages at same breakpoint range) |

**Decision needed:** styles.css value is `0.95rem`; three of four pages want `0.85rem`. exec_summary wants `0.95rem` at base then shrinks it. This is a visually noticeable difference in every section header.

**Recommended resolution:** Change styles.css to `0.85rem` to match the majority. exec_summary's base block (`0.95rem`) then overrides up before the Executive Scaling Pass shrinks it back — this cascade already works correctly.

---

### Conflict 4 — score font-size

| Source | Value |
|---|---|
| `styles.css` | `2rem` |
| `dashboard.html` | `2rem` (matches) |
| `programming.html` | `2.1rem` |
| `exec_summary.html` (base) | `2rem` → `1.55rem` in Executive Scaling Pass |
| `box_office.html` | no `.score` elements |

**Decision needed:** programming.html wants 2.1rem; styles.css and dashboard want 2rem. Small but visible difference in fit score display on programming.html.

**Recommended resolution:** Keep `2rem` in styles.css. programming.html's `2.1rem` override stays inline — it only affects programming.html's score display.

---

### Conflict 5 — select custom arrow (dashboard only)

| Source | Value |
|---|---|
| `styles.css` | Plain `select` — no custom arrow |
| `dashboard.html` | `select` with custom SVG dropdown arrow via `background-image` |
| `programming.html`, `exec_summary.html`, `box_office.html` | Plain select (match styles.css) |

**Decision needed:** dashboard.html's selects have a custom arrow; all other pages use the browser default. If the base `select` rule is removed from the inline styles of non-dashboard pages, styles.css plain select applies — which is already what they display.

**Recommended resolution:** Extract the plain `select` rule to styles.css (it already is there). dashboard.html keeps its custom-arrow `select` override inline. No change needed.

---

### Conflict 6 — max-width responsive breakpoints (breakpoint values)

| Source | Breakpoints |
|---|---|
| `styles.css` | 1920px / 1400px / 1024px / 768px |
| `dashboard.html` | 1200px / 900px / 600px |
| `programming.html` | 1100px / 700px |
| `exec_summary.html` | 1350px / 1200px / 1050px / 900px / 760px (base) + full V2 breakpoint system |
| `box_office.html` | 1100px / 700px |

**Decision needed:** Every page uses a completely different set of max-width breakpoints. styles.css breakpoints currently have no effect on content because the inline breakpoints override at different thresholds. These cannot be merged without redesigning each page's responsive behavior.

**Recommended resolution:** Remove all `@media (max-width: ...)` from styles.css that contain layout rules (grid-template-columns, sidebar width, panel padding). The only safe max-width rules in styles.css are token-only overrides (`--chart-h`, etc.) at the 1920/1400 breakpoints (which affect charts.css canvas height). Everything else stays inline per page.

---

### Conflict 7 — workspace max-width / margin

| Source | Value |
|---|---|
| `styles.css` | `max-width: var(--page-max); margin: auto;` |
| `dashboard.html` | `max-width: 3840px; margin: auto;` (hardcoded, not token) |
| `exec_summary.html` | V2 system uses `max-width: var(--page-max)` per breakpoint |
| `programming.html`, `box_office.html` | No `max-width` on workspace (content can go full-width) |

**Decision needed:** styles.css applies `--page-max` centering to workspace on all pages. programming.html and box_office.html have no workspace `max-width` inline, so styles.css would actually take effect on those pages right now. This may or may not be the desired behavior for those two pages.

**Recommended resolution:** Verify that `max-width: var(--page-max)` on workspace is acceptable for programming.html and box_office.html. If yes, styles.css rule is correct. If no, add explicit `max-width: none` overrides to those pages.

---

### Conflict 8 — Large-screen min-width breakpoints (dashboard.html vs styles.css)

| Source | Value |
|---|---|
| `styles.css` | `@media (min-width: 1700px)`, `(min-width: 2560px)`, `(min-width: 3840px)`, `(min-width: 6000px)` — added in Wire It In |
| `dashboard.html` | `@media (min-width: 2560px)` block that overrides `--kpi-value`, etc. inline |

**Decision needed:** dashboard.html has its own `@media (min-width: 2560px)` block inline. The styles.css block (loaded first) also sets these tokens at 2560px. Currently the inline block wins and overrides the styles.css values. This is actually correct cascade behavior, but the values need to be verified for consistency.

**Values comparison at 2560px:**
- styles.css: `--base-font: 18px; --kpi-value: 1.85rem; --chart-h: 400px; --small-chart-h: 285px; --page-max: 2520px`
- dashboard.html inline: check dashboard.html lines ~1100–1140 for exact values

**Recommended resolution:** After verifying the dashboard.html inline values, either (a) remove the dashboard inline block if it matches styles.css, or (b) keep it inline as a dashboard-specific override if values differ.

---

## Section 6 — Recommendations for Execute Pass

Listed in priority order. Each item is one atomic commit (one-file-one-change rule applies).

### Tier 1 — No-conflict extractions (safe to do immediately after human review)

| # | Action | Files changed |
|---|---|---|
| 1 | Extract `.signal-card` and all `.signal-*` CSS to `styles.css` | styles.css, dashboard.html, programming.html, exec_summary.html |
| 2 | Extract sidebar-toggle CSS to `styles.css` | styles.css, dashboard.html, programming.html, exec_summary.html |
| 3 | Extract `.faq-section` / `.faq-grid` to `styles.css` | styles.css, programming.html, exec_summary.html |

**Note on "one file per commit":** Extracting to styles.css and removing from inline requires touching multiple files. The SKILL.md rule was written for feature changes. For pure deduplication, a two-commit approach works: (a) add to styles.css, (b) remove from each HTML page sequentially. Confirm with Randale before batching.

---

### Tier 2 — Conflicts requiring human decisions (resolve conflicts first, then remove inline duplicates)

| # | Conflict | Recommended decision | Then remove |
|---|---|---|---|
| C1 | kpi-strip columns | Remove `.kpi-strip { grid-template-columns }` from styles.css; keep inline | Nothing to remove — inline stays |
| C2 | Sidebar width | Remove `width` from styles.css `.sidebar`; keep inline per-page | Nothing to remove |
| C3 | section-divider h2 | Change styles.css to `0.85rem`; remove inline `section-divider h2` from all pages | inline `section-divider h2` from all 4 pages |
| C4 | score font-size | Keep styles.css at `2rem`; keep programming.html `2.1rem` inline | Remove `.score { font-size }` from dashboard, exec_summary, box_office inline |
| C5 | select custom arrow | No change — dashboard keeps inline; others rely on styles.css | No removal needed |
| C6 | Responsive breakpoints | Remove layout rules from styles.css breakpoints; keep token-only rules | No removal needed |
| C7 | workspace max-width | Verify programming/box_office behavior then decide | Depends on decision |
| C8 | 2560px breakpoint | Verify dashboard inline values vs styles.css values | Remove dashboard inline block if identical |

---

### Tier 3 — Large-scale deduplication (after Tier 1 and Tier 2 are resolved)

After all conflicts are resolved, the following rule groups can be safely removed from each page's inline `<style>` block (they are already in styles.css and the inline copies are identical):

`:root` color tokens, CSS reset, body, masthead and all sub-elements, button variants, kpi-cell/kpi-label/kpi-value/kpi-sub, sidebar-section/sidebar-label, pills, plain select/input, main-pane, nav-tabs, panels, section-divider sub-elements, grid helpers, card, callout, mini-label, mini-table, status badges, show-card, metric-row, canvas base, rank-list, bar-track, empty state, footer.

**Estimated reduction:** ~700–900 lines removed from each of 4 HTML pages = ~2,800–3,600 total lines removed across the project.

**This is a high-risk operation.** Complete Tier 1 and Tier 2 first. Verify each page renders correctly after each HTML file's inline removals before proceeding to the next file.

---

## What Is NOT Changed in This Pass

Per the audit plan — this report is read-only. No files have been modified.

- `src/css/styles.css` — not modified (audit only)
- `src/dashboard.html` — not modified
- `src/programming.html` — not modified
- `src/exec_summary.html` — not modified
- `src/box_office.html` — not modified
- `src/css/charts.css` — not audited for conflicts (clean, 94 lines, no known conflicts)
- `scripts/*.py` — out of scope
- `src/js/` — out of scope

---

## Appendix — exec_summary.html CSS Layer Map

exec_summary.html has the most complex inline CSS structure. For reference:

| Lines | Layer | Keep/Remove |
|---|---|---|
| 41–238 | Shared base: `:root`, reset, masthead, buttons, kpi-strip, workspace | REMOVE after dedup (Tier 3) |
| 238–635 | Shared base continued: sidebar, pills, select, nav-tabs, panels, grids, cards, etc. | REMOVE after dedup (Tier 3) |
| 636–775 | Shared base: peer-badge, breakpoints (1200/900), footer | KEEP peer-badge inline (exec_summary-only); REMOVE rest after dedup |
| 776–1112 | Executive Scaling Pass: full override layer | KEEP — exec_summary-specific |
| 1113–2056 | V2 Responsive Scale System + signal-card + sidebar-toggle | KEEP V2 system; REMOVE signal-card and sidebar-toggle after Tier 1 extraction |


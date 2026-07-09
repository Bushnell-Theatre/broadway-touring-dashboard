# Claude Code Instructions — Broadway Touring Dashboard

## CSS Architecture — Non-Negotiable Rules

### One stylesheet. All breakpoints in styles.css. No exceptions.

`src/css/styles.css` is the single source of truth for all layout, spacing,
typography, color, and responsive behavior across all four pages.

**No inline `@media` block may be added to any HTML file — ever.**
The only permitted exception is `@media print`, which may remain inline
because print layout is genuinely page-specific.

If a new responsive behavior is needed:
1. Add it to `styles.css` in the appropriate canonical breakpoint block.
2. If only one page needs the behavior, confirm it truly cannot be shared.
   If it can't, scope it with a body class (`body.page-dashboard`) inside
   `styles.css` — still in `styles.css`, not inline.
3. Never add a new breakpoint value without checking the canonical set first.

### Canonical breakpoint set

These are the only breakpoint values used in this project.
Do not invent new ones without explicit instruction.

| Block | When it fires |
|---|---|
| `@media (min-width: 6000px)` | 8K wall display |
| `@media (min-width: 3840px) and (max-width: 5999px)` | 4K conference display |
| `@media (min-width: 2560px) and (max-width: 3839px)` | 2.5K / QHD |
| `@media (min-width: 1440px) and (max-width: 2559px)` | Standard desktop |
| `@media (min-width: 1700px)` | Large desktop layout adjustments |
| `@media (min-width: 1101px) and (max-width: 1439px)` | Laptop |
| `@media (min-width: 901px) and (max-width: 1100px)` | Tablet landscape |
| `@media (min-width: 761px) and (max-width: 900px)` | Tablet portrait |
| `@media (max-width: 1200px)` | Small laptop / tablet landscape |
| `@media (max-width: 900px)` | iPad — sidebar collapses to toggle |
| `@media (max-width: 768px)` | Mobile / iPad portrait |

### Inline `<style>` blocks — what belongs there

Each HTML page has an inline `<style>` block for rules that are **genuinely
page-specific**: components that exist only on that page, visual overrides
that would be wrong if applied globally.

Every rule in an inline block must have a comment: `/* page-specific — reason */`

If you are about to add a rule without that comment, ask: does this belong in
`styles.css` instead? It usually does.

### All pages share the same sidebar toggle pattern

`toggleSidebar()`, `.sidebar-toggle`, and `.sidebar-backdrop` are implemented
identically on all four pages. Do not diverge this pattern. If you change the
toggle behavior on one page, apply the same change to all four.

---

## Versioning

`src/data/versions.json` is the single source of truth for all page version numbers and dates.

**Do not hardcode version strings in any HTML file.** Each page fetches `versions.json` at
boot and injects its version into `id="pageVersion"` and `id="pageDate"` elements. The
`index.html` hub card version spans use `id="ver-<key>"` and are also populated from this file.

To bump a version: edit `versions.json` only — one commit, all pages update automatically.

### Version format: MAJOR.MINOR

Pages use two-part versioning (`v5.2`, `v2.1`). No patch number — these are not libraries.

| Part | Bump when |
|---|---|
| **MAJOR** | Page is architecturally rebuilt; a significant feature is removed; the data model changes in a breaking way; the page's fundamental purpose changes |
| **MINOR** | New feature added (new tab, new chart, new data source, new workflow); significant UI enhancement; backward-compatible data model addition |
| **No bump** | Bug fix, CSS tweak, copy edit, data pipeline update, breakpoint adjustment — these ship as deploys without a version change |

**When in doubt: MINOR.** The version signals to stakeholders that something meaningfully
new is available. Bug fixes and styling don't rise to that bar.

**Both the version AND the date must be updated together in `versions.json`.** A version
bump with a stale date is misleading.

### Current versions (update this table when bumping)

| Page | Current | Last meaningful change |
|---|---|---|
| dashboard.html | v5.0 | June 24, 2026 — initial production release |
| programming.html | v5.2 | July 6, 2026 — Planning Signal redesign |
| exec_summary.html | v5.2 | July 6, 2026 — Planning Signal redesign |
| box_office.html | v2.1 | June 30, 2026 — venues.json integration |

---

## The Golden Rule — One File, One Change

Make one file change, commit, verify in the browser, then move to the next.
Never batch changes across multiple HTML files into a single commit unless the
task explicitly requires it (e.g. a shared CSS extraction to styles.css).

This rule was established after aggressive multi-file refactoring broke pages
and required a full revert. It is not optional.

---

## Branch Policy

### Three-tier model

```
main          ← production (Azure auto-deploy, ~30 sec)
  └── dev     ← staging / integration (always contains finished work only)
        └── feat/xxx  ← active development (one feature or fix per branch)
```

### Publishing workflow — follow every time, no exceptions

**Step 1 — Feature branch**

All work starts on a feature branch off `dev`:

```bash
git checkout dev
git checkout -b feat/my-feature
```

Commit freely on the feature branch. One logical change per commit.

**Step 2 — Merge to dev (staging)**

When the feature is complete and verified in the browser:

```bash
git checkout dev
git merge feat/my-feature
git push origin dev
git branch -d feat/my-feature
```

Stop here. Tell the user what was pushed to dev. Do not touch `main`.

**Step 3 — Merge to main (production) — confirmation required**

Do not proceed until the user explicitly asks to deploy to production.
When they do, respond with this prompt in a message — do not run the command yet:

> Ready to run:
> ```
> git checkout main && git merge dev && git push origin main && git checkout dev
> ```
> This will deploy to production via Azure (~30 sec). Reply to confirm.

Wait for the user to reply in a **new message**. Only then run the command.

**A one-word reply ("merge", "yes", "push") in the same conversational turn
that proposed the deploy does not count as confirmation.** The confirmation
must come in a separate message after the user has seen the prompt above.

Azure deploys are not reversible without a revert commit. When in doubt, wait.

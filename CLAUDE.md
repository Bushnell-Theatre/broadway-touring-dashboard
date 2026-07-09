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

## The Golden Rule — One File, One Change

Make one file change, commit, verify in the browser, then move to the next.
Never batch changes across multiple HTML files into a single commit unless the
task explicitly requires it (e.g. a shared CSS extraction to styles.css).

This rule was established after aggressive multi-file refactoring broke pages
and required a full revert. It is not optional.

---

## Branch Policy

All work happens on the `dev` branch. Do not push to `main` without explicit
confirmation from the user. "Publish" or "deploy" means push to `dev` unless
the user says otherwise.

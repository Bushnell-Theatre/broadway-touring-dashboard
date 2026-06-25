# Phase 10 — Browser Smoke Test and Deployment Hardening

## Scope

This pass is a deployment-readiness and smoke-test pass for the refactored Broadway Touring Intelligence Dashboard.

No CSS files were modified in this phase. The goal was to verify that the refactored shared JavaScript layer, extracted page controllers, dashboard analytics module, validation scripts, and pipeline utilities are in a deployable state.

## Validation Completed

### JavaScript syntax checks

Passed:

```bash
node --check src/js/core/*.js
node --check src/js/pages/*.js
node --check scripts/compare_signals.js
```

### Python compile checks

Passed:

```bash
python3 -m py_compile scripts/*.py
```

### Data validation

Passed:

```bash
python3 scripts/validate_data.py --data src/data/data.json --out src/data/validation_report.json
```

Latest validation summary:

| Check | Result |
|---|---:|
| Records | 10,798 |
| Unique canonical keys | 10,798 |
| Duplicate canonical keys | 0 |
| Unique shows | 175 |
| Unique theatre/city pairs | 557 |
| Peer venue matches | 57 |
| Invalid dates | 0 |
| Paid capacity over 100% | 143 |
| Total capacity over 100% | 202 |
| Gross % potential over 100% | 1,145 |
| Gross over potential | 1,153 |
| No-engagement rows | 4,778 |

Above-100 values are retained and surfaced as known Broadway League reporting conditions, not automatically treated as errors.

### Canonical signal checks

Passed:

```bash
node scripts/compare_signals.js 2025-2026
node scripts/compare_signals.js 2026-2027
```

Both seasons produced canonical Demand / Revenue / Peer / Confidence / Planning Read values for all slate titles.

### Local static HTTP checks

A local static server was started from `src/`:

```bash
cd src
python3 -m http.server 8765
```

The following returned HTTP 200:

| Path | Result |
|---|---:|
| `/` | 200 |
| `/index.html` | 200 |
| `/programming.html` | 200 |
| `/exec_summary.html` | 200 |
| `/dashboard.html` | 200 |
| `/unauthorized.html` | 200 |
| `/data/data.json` | 200 |
| `/data/validation_report.json` | 200 |
| `/js/core/config.js` | 200 |
| `/js/core/dashboard-analytics.js` | 200 |
| `/js/pages/dashboard.page.js` | 200 |

### Static asset reference scan

HTML `src`/`href` references were scanned for missing local files. The only non-file reference detected was the expected Azure Static Web Apps auth route:

```text
/.auth/login/aad?post_login_redirect_uri=/
```

This is expected and should not exist as a local file.

## Manual Browser Smoke Test Still Recommended

The sandbox did not perform a true headed browser interaction test. Before pushing to `main`, run this locally or in staging:

1. Open `/` and confirm all navigation cards work.
2. Open `/programming.html`.
   - Confirm the page loads without console errors.
   - Switch seasons.
   - Open tabs.
   - Confirm title cards render.
   - Confirm charts render.
   - Confirm Demand / Revenue / Peer / Confidence language appears consistently.
3. Open `/exec_summary.html`.
   - Confirm leadership summary cards render.
   - Confirm season switching works.
   - Confirm watchlist/strong-candidate areas render.
   - Confirm wording aligns with Programming page.
4. Open `/dashboard.html`.
   - Confirm raw table renders.
   - Confirm filters work.
   - Confirm ranking panels render.
   - Confirm charts render.
   - Confirm analytics and peer sections render.
5. Check browser console for JavaScript errors.
6. Confirm Azure auth behavior in staging/production if Entra ID lockdown is enabled.

## Deployment Recommendation

Push to `dev` first, not `main`.

Recommended workflow:

```bash
git checkout -b phase10-refactor-readiness
# copy these files into the repo
git status
git add .
git commit -m "Refactor dashboard shared logic and deployment readiness"
git push origin phase10-refactor-readiness
```

Then merge/deploy to the existing `dev` branch or staging process.

Do not deploy directly to production until the manual browser smoke test is completed.

## Current Architecture State

The project now has:

- shared `BTD` namespace
- shared core modules in `src/js/core/`
- extracted page controllers in `src/js/pages/`
- canonical Demand / Revenue / Peer / Confidence planning signal logic
- Dashboard-specific analytics extraction
- shared Dashboard chart lifecycle helpers
- shared Dashboard table rendering helpers
- Python pipeline configuration and validation utilities
- safer show scrape behavior when `SPARQLWrapper` is unavailable

## Known Caveats

1. The visual browser test still needs to be run locally or in staging.
2. Dashboard remains the largest and most operationally complex page, though it is now significantly cleaner than before.
3. Revenue Signal is still revenue quality, not net profit. Deal terms, local expenses, presenter economics, and ancillary revenue are not yet modeled.
4. Show scrape live API behavior should be tested locally because the sandbox could not verify live Wikidata/Wikipedia/DBpedia network calls.
5. `watcher.py` still depends on the local machine/watch folder workflow unless migrated to Azure Functions or another cloud trigger.

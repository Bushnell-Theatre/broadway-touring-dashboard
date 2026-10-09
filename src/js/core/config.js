(function (root) {
  'use strict';
  root.BTD = root.BTD || {};
  root.BTD.config = Object.assign({
    appName: 'Broadway Touring Intelligence Dashboard',
    defaultSeason: '2025-2026',
    dataUrls: [
      'data/data.json',
      'https://white-pebble-01710020f.7.azurestaticapps.net/data/data.json'
    ],
    contextUrls: [
      'data/context.json',
      'https://white-pebble-01710020f.7.azurestaticapps.net/data/context.json'
    ],
    seasonsUrl: 'data/seasons.json',
    peersUrl: 'data/peers.json',
    showsUrl: 'data/shows.json',
    awardsUrl: 'data/awards.json',
    mediaSignalsUrl: 'data/media_signals.json',
    titleAliasesUrl: 'data/title_aliases.json',
    validationUrl: 'data/validation_report.json',

    /* ── WEEKLY INTELLIGENCE — TEMPORARILY DISABLED (October 9, 2026) ────────
     * The AI weekly highlight / pulse callout on Programming and Executive
     * Summary is switched off pending the production-title identity review.
     *
     * Why: the shared title matcher resolves a slate entry to records by
     * bidirectional substring, so where the Broadway League distinguishes
     * productions with a year/version suffix the match blends them. A slate
     * entry mapped to "Waitress 2026" still pulls in the 2019-2022 "Waitress"
     * records. Weekly copy written on a blended population can state an
     * absence, a record high or a week-over-week change that belongs to a
     * different production — so the feature is paused rather than left to
     * publish claims nobody can verify.
     *
     * What is NOT affected: data ingestion, revision processing, every
     * Dashboard metric, and the season retrospective callout (which is
     * generated separately by generate_season_review.py and still renders).
     *
     * To reactivate, ALL of the following must hold:
     *   1. the shared matcher does exact, production-aware title matching;
     *   2. every active slate mapping in seasons.json has been reviewed
     *      against the League titles actually present in data.json;
     *   3. highlight claims validate against the correct production
     *      population — not a blended one.
     * Then set this flag true and re-enable Step 2.75 in scripts/watcher.py.
     * The generator, the guard, the stored JSON and all rendering code are
     * intentionally left in place.
     * ─────────────────────────────────────────────────────────────────────── */
    weeklyIntelligenceEnabled: false
  }, root.BTD.config || {});
})(window);

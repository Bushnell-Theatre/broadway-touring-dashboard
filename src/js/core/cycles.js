(function (root) {
  'use strict';
  root.BTD = root.BTD || {};

  /* Tour cycles
   * ---------------------------------------------------------------------
   * The Broadway League feed files each tour cycle of a title under its own
   * show name, distinguished by a trailing marker: a year ("Waitress 2026"),
   * a small ordinal ("Jersey Boys 2"), a roman numeral ("Holidaze II"), or
   * "Pre" for a pre-Broadway tryout ("BOOP! The Betty Boop Musical Pre").
   *
   * Stripping that marker gives a TITLE FAMILY, which is what a programmer
   * means by "the show". This module groups a family's rows back into their
   * cycles so a page can show how the title has performed over its whole
   * touring life while still breaking out the current version.
   *
   * Two shapes exist in the data and must not be confused:
   *   - SUCCESSIVE cycles - one tour ends, a later one begins. A cycle-over-
   *     cycle delta is meaningful here.
   *   - CONCURRENT companies - several companies tour at once under separate
   *     names (Hamilton's Angelica/Philip/Eliza/And Peggy all open the same
   *     week). A delta between them is meaningless.
   *
   * Overlap is judged per adjacent PAIR, not per family. Waitress hands over
   * from one cycle to the next across a four-week overlap in 2022 and then
   * returns in 2026: only the handover pair is non-comparable, and the 2026
   * cycle still earns a delta. `concurrent` is set on the family only when
   * EVERY adjacent pair overlaps, which is the true several-companies-at-once
   * case.
   *
   * A pre-Broadway tryout ("The Wiz 2023 Pre") is marked isPre and is skipped
   * when chaining deltas - a tryout sit-down is not a tour, and scoring the
   * following tour against it reads as a collapse that never happened.
   *
   * Grouping is inferred from the trailing marker, so a feed RENAME is not
   * detected on its own: "SIX: The Musical (Boleyn)" differs from "Six
   * (Boleyn)" in the stem, not the marker. setAliases() takes the raw
   * title_aliases.json and folds those together by hand.
   *
   * The map is normalized HERE rather than reused from BTD.state.titleAliases,
   * which data.js builds with its own normalizeName. The two normalizers
   * disagree - data.js strips a leading "the", signals.js keeps it - so
   * data.js's map is keyed "lion king rafiki" where this module looks up
   * "the lion king rafiki", and every aliased title beginning with "The"
   * would silently miss.
   */

  var CYCLE_MARKER = /\s+(?:pre|i{1,3}|\d{4}|\d{1,2})$/;

  function norm(s) {
    if (root.BTD.signals && root.BTD.signals.normalizeName) return root.BTD.signals.normalizeName(s);
    return String(s || '').toLowerCase().replace(/&/g, 'and')
      .replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  /* Raw title_aliases.json -> a map keyed by THIS module's normalizer. */
  var _aliases = null;
  function normalizeAliasMap(raw) {
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (k) { out[norm(k)] = norm(raw[k]); });
    return out;
  }
  function setAliases(raw) {
    _aliases = normalizeAliasMap(raw);
    return _aliases;
  }

  /* Alias and marker-strip are interleaved, because either can expose the
   * other. "A Beautiful Noise Pre" only reaches its alias once "Pre" is
   * stripped, while "SIX: The Musical (Boleyn)" is aliased before any
   * stripping happens. The guard bounds a map that cycles back on itself. */
  function familyKey(title, aliases) {
    var key = norm(title);
    if (!key) return '';
    var map = aliases || _aliases;
    var guard = 0;
    while (guard++ < 8) {
      if (map && map[key] && map[key] !== key) { key = map[key]; continue; }
      var next = key.replace(CYCLE_MARKER, '').trim();
      /* A title that is nothing but a marker ("1776") must keep its name. */
      if (!next || next === key) break;
      key = next;
    }
    return key;
  }

  /* cycleKey(title) -> the identity of ONE cycle inside a family.
   *
   * familyKey answers "which show is this". This answers "which run of it",
   * which is a different question and cannot be the raw feed string.
   *
   * The feed marks a run three ways, and one run can carry two of them:
   *   - a parenthetical company       "Six (Boleyn)", "Hamilton (Angelica)"
   *   - a trailing marker             "...Christmas 2019", "Holidaze II"
   *   - a hyphenated year-and-company "...Christmas 2024-Old Max"
   * plus the combination, "The Lion King (Toronto) 2024".
   *
   * Keying on the raw string splits a company the moment the feed renames
   * its stem. "Six (Boleyn)" ran to 2025-02-02 and "SIX: The Musical
   * (Boleyn)" picked up the very next reporting week; they showed as two
   * versions, and the cycle-over-cycle delta compared the company against
   * itself (-5.8 points). "MJ" / "MJ The Musical" split the same way.
   *
   * So: strip the run markers off, alias what is left — that is the family —
   * then put the markers back as the distinguishing part. A rename folds
   * together because only the stem changed; (Aragon) stays apart from
   * (Boleyn), and 2019 from 2021, because their markers differ.
   *
   * Marker extraction runs on the ORIGINAL title, before aliasing, because
   * title_aliases.json also carries whole-title entries that fold one run
   * into its family ("...Christmas 2024-Old Max" -> "...Christmas"). Alias
   * first and every Grinch run collapses into one.
   */
  var HYPHEN_RUN = /\s(\d{4})\s*[-–]\s*(\S.*)$/;

  function cycleKey(title, aliases) {
    var raw = String(title || '');
    var parts = [];

    /* Unwrap before normalizing: norm() deletes a parenthetical whole, so
     * norm('(Boleyn)') is the empty string and every company would collapse
     * into one. The brackets come off first, then the contents normalize. */
    var parens = raw.match(/\([^)]*\)/g);
    var rest = parens ? raw.replace(/\([^)]*\)/g, ' ') : raw;
    if (parens) {
      parts.push(norm(parens.map(function (p) { return p.slice(1, -1); }).join(' ')));
    }

    var hy = rest.match(HYPHEN_RUN);
    if (hy) {
      parts.push(norm(hy[1] + ' ' + hy[2]));
      rest = rest.slice(0, hy.index);
    }

    var tail = norm(rest).match(CYCLE_MARKER);
    if (tail) parts.push(tail[0].trim());

    var key = familyKey(rest, aliases);
    return parts.length ? key + '|' + parts.join('|') : key;
  }

  var PERF = ['num_perf', 'gross_gross', 'gross_potential', 'gg_pct_gp', 'paid_tix',
              'total_tix', 'capacity', 'cap_paid', 'cap_total', 'avg_adm'];
  function isActive(r) {
    if (!r) return false;
    if (!r.no_engagement) return true;
    return PERF.some(function (k) {
      var v = r[k];
      return v != null && v !== '' && Number.isFinite(+v);
    });
  }
  function mean(rows, field) {
    var v = rows.map(function (r) { return r[field]; })
      .filter(function (x) { return x != null && Number.isFinite(+x); }).map(Number);
    return v.length ? v.reduce(function (a, b) { return a + b; }, 0) / v.length : null;
  }

  /* cyclesFor(title, records, options) -> null, or
   *   { family, concurrent, cycles: [ { title, weeks, first, last, capPaid,
   *     avgGross, capDelta } ], latest, overall: { weeks, capPaid, avgGross } }
   * Cycles are ordered oldest first. capDelta is the change in paid capacity
   * against the preceding cycle, and is null on the first cycle and on every
   * cycle of a concurrent family.
   */
  function cyclesFor(title, records, options) {
    options = options || {};
    var aliases = options.aliases || _aliases || null;
    var fam = familyKey(title, aliases);
    if (!fam) return null;

    var all = records || (root.BTD.state && root.BTD.state.all) || [];
    var mine = all.filter(function (r) { return familyKey(r.show, aliases) === fam; });
    if (!mine.length) return null;

    /* Group by run identity, not by the raw feed string — see cycleKey. */
    var byTitle = {};
    mine.forEach(function (r) {
      var k = cycleKey(r.show, aliases);
      (byTitle[k] = byTitle[k] || []).push(r);
    });

    var cycles = Object.keys(byTitle).map(function (k) {
      var active = byTitle[k].filter(isActive);
      var weeks = active.map(function (r) { return r.week_of; }).filter(Boolean).sort();
      /* A renamed run carries both feed names. Display the newer one: it is
       * what the League calls the tour now and what the user will recognise. */
      var named = byTitle[k].filter(function (r) { return r.show && r.week_of; })
        .sort(function (a, b) { return String(a.week_of).localeCompare(String(b.week_of)); });
      var t = named.length ? named[named.length - 1].show : byTitle[k][0].show;
      return {
        title: t,
        rows: byTitle[k],
        isPre: norm(t).split(' ').pop() === 'pre',
        overlapsPrev: false,
        comparedTo: null,
        weeks: active.length,
        first: weeks[0] || null,
        last: weeks[weeks.length - 1] || null,
        capPaid: mean(active, 'cap_paid'),
        avgGross: mean(active, 'gross_gross'),
        capDelta: null
      };
    }).filter(function (c) { return c.weeks > 0; })
      .sort(function (a, b) { return String(a.first).localeCompare(String(b.first)); });

    if (!cycles.length) return null;

    var overlaps = 0;
    for (var i = 1; i < cycles.length; i++) {
      cycles[i].overlapsPrev = cycles[i].first <= cycles[i - 1].last;
      if (cycles[i].overlapsPrev) overlaps++;
    }
    var concurrent = cycles.length > 1 && overlaps === cycles.length - 1;

    /* Chain each delta to the previous TOURING cycle, skipping tryouts. */
    var lastTour = null;
    cycles.forEach(function (c) {
      if (!c.overlapsPrev && !c.isPre && lastTour &&
          c.capPaid != null && lastTour.capPaid != null) {
        c.capDelta = c.capPaid - lastTour.capPaid;
        c.comparedTo = lastTour.title;
      }
      if (!c.isPre) lastTour = c;
    });

    var allActive = mine.filter(isActive);
    return {
      family: fam,
      concurrent: concurrent,
      cycles: cycles,
      latest: cycles[cycles.length - 1],
      overall: {
        weeks: allActive.length,
        capPaid: mean(allActive, 'cap_paid'),
        avgGross: mean(allActive, 'gross_gross')
      }
    };
  }

  root.BTD.cycles = { familyKey: familyKey, cyclesFor: cyclesFor, setAliases: setAliases };
})(window);

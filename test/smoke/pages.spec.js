const { test, expect } = require('@playwright/test');

/*
 * Smoke tests — every page loads, every tab opens, every panel fills.
 *
 * The contract each page follows:
 *   - clickable tab controls carry data-tab="<name>" and call showTab('<name>')
 *   - showTab() clears .active from every .panel, then activates #tab-<name>
 *   - the activated panel renders content
 *
 * The failure this is built to catch: a control whose data-tab has no matching
 * #tab-<name> panel. showTab() deactivates every panel and then throws on the
 * missing element, so the user is left looking at a blank page until they
 * reload. Nothing short of a real browser notices.
 */

const PAGES = ['dashboard.html', 'exec_summary.html', 'programming.html', 'box_office.html'];

/*
 * Errors we accept, and why. Keep this list short and specific — a broad
 * pattern here is how a suite goes green while the page is broken.
 */
const IGNORED_ERRORS = [
  /favicon/i,

  /*
   * exec_summary.html:1971 and programming.html:1152 fetch context.json from
   * the absolute production URL unconditionally, with no relative path tried
   * first. Same-origin on Azure, so it works in production; served from
   * anywhere else it is a CORS failure and those pages silently lose their
   * context data. Not a production bug, so it does not fail the suite — but it
   * is a real inconsistency (config.js and programming.html's DATA_URLS both
   * do this correctly, relative first with the absolute URL as fallback).
   * Fix those two fetches and this entry should be deleted.
   */
  /white-pebble-01710020f\.7\.azurestaticapps\.net/,
  /Failed to load resource: net::ERR_FAILED/,
];

function isRealError(text) {
  return !IGNORED_ERRORS.some((re) => re.test(text));
}

/** Attach error collection to a page. Returns the live array. */
function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && isRealError(msg.text())) {
      errors.push(`console.error: ${msg.text()}`);
    }
  });
  return errors;
}

/** Load a page and wait for its data fetches to settle. */
async function load(page, name) {
  await page.goto(`/${name}`, { waitUntil: 'networkidle' });
}

test.describe('page loads', () => {
  test('index hub loads with no errors', async ({ page }) => {
    const errors = collectErrors(page);
    await load(page, 'index.html');
    await expect(page.locator('body')).toBeVisible();
    expect(errors, `index.html reported errors:\n${errors.join('\n')}`).toEqual([]);
  });

  for (const name of PAGES) {
    test(`${name} loads with no errors`, async ({ page }) => {
      const errors = collectErrors(page);
      await load(page, name);

      // A panel must be active on arrival, and it must have content.
      const active = page.locator('.panel.active');
      await expect(active).toHaveCount(1);
      const text = ((await active.textContent()) || '').trim();
      expect(text.length, `${name}: the landing panel rendered empty`).toBeGreaterThan(0);

      expect(errors, `${name} reported errors on load:\n${errors.join('\n')}`).toEqual([]);
    });
  }
});

test.describe('tab navigation', () => {
  for (const name of PAGES) {
    test(`${name} — every tab control opens a panel that fills`, async ({ page }) => {
      const errors = collectErrors(page);
      await load(page, name);

      /*
       * Discover controls by the onclick that actually runs, not by data-tab.
       * The markup has drifted between pages: programming.html and
       * box_office.html put data-tab on their nav tabs, dashboard.html and
       * exec_summary.html do not. Selecting on data-tab finds nothing on half
       * the pages and quietly passes.
       *
       * A page may offer the same tab twice (a nav tab and a sidebar pill).
       * Both get clicked — either one can be the broken one.
       */
      const controlLocator = page.locator('[onclick*="showTab"]');
      const controls = await controlLocator.evaluateAll((els) =>
        els.map((el) => {
          const match = (el.getAttribute('onclick') || '').match(/showTab\(\s*['"]([^'"]+)['"]/);
          return {
            tab: match ? match[1] : null,
            declared: el.dataset.tab || null,
            label: (el.textContent || '').trim(),
          };
        }),
      );

      expect(controls.length, `${name}: found no tab controls to click`).toBeGreaterThan(0);

      const failures = [];

      for (let i = 0; i < controls.length; i++) {
        const { tab, declared, label } = controls[i];
        const before = errors.length;

        if (!tab) {
          failures.push(`"${label}" → onclick calls showTab but no tab name could be read from it`);
          continue;
        }

        // data-tab drives the active-pill styling while onclick drives the
        // panel. When they disagree the control works but looks inactive.
        if (declared && declared !== tab) {
          failures.push(`"${label}" → data-tab="${declared}" but onclick opens "${tab}"`);
        }

        // Panels this control claims to open must exist before we click —
        // clicking a control with no panel blanks the page for every later tab.
        const panelCount = await page.locator(`#tab-${tab}`).count();
        if (panelCount === 0) {
          failures.push(`"${label}" (data-tab="${tab}") → no #tab-${tab} panel exists`);
          continue;
        }

        await controlLocator.nth(i).click();

        const active = page.locator('.panel.active');
        const activeCount = await active.count();
        if (activeCount !== 1) {
          failures.push(`"${label}" (${tab}) → ${activeCount} active panels after click, expected 1`);
          await load(page, name); // recover for the remaining tabs
          continue;
        }

        const activeId = await active.getAttribute('id');
        if (activeId !== `tab-${tab}`) {
          failures.push(`"${label}" (${tab}) → activated #${activeId}, expected #tab-${tab}`);
        }

        const text = ((await active.textContent()) || '').trim();
        if (text.length === 0) {
          failures.push(`"${label}" (${tab}) → panel #tab-${tab} rendered empty`);
        }

        const newErrors = errors.slice(before).filter(isRealError);
        if (newErrors.length) {
          failures.push(`"${label}" (${tab}) → ${newErrors.join(' | ')}`);
          await load(page, name); // recover for the remaining tabs
        }
      }

      expect(
        failures,
        `${name}: ${failures.length} of ${controls.length} tab controls failed:\n  ${failures.join('\n  ')}`,
      ).toEqual([]);
    });
  }
});

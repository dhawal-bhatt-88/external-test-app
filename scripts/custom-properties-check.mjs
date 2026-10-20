// Computed styles of the package stylesheet in a real browser, for the
// custom-properties work in @zoworkhq/forms (renderer brief
// RENDERER-BRIEF-CUSTOM-PROPERTIES.md).
//
//   node scripts/custom-properties-check.mjs baseline <out.json> --version <x.y.z>
//     Measures every theme × density × state with no host custom properties
//     set, and writes the result. Run against 0.25.0 to make the baseline.
//
//   node scripts/custom-properties-check.mjs check <baseline.json> --version <x.y.z> [--screenshots <dir>]
//     With nothing set, every value must equal the baseline, with the theme
//     and density on a wrapper and on the roots. Then host values set on
//     :root, a wrapper and the roots, in every theme and density; their
//     order; a dark-only override; derived properties; an invalid value;
//     and an override inside the form, which no longer applies. Exits 1 on
//     any failure.
//
// Before measuring, both modes check what the dev server actually serves:
// the page must report --version, and in check mode the package stylesheet
// must contain --_zf-. Vite doesn't watch node_modules, so after an install
// it serves the old package until it is restarted with node_modules/.vite
// cleared; without this, a stale cache would measure the old stylesheet and
// pass.
//
// Needs the dev server (npx vite) on http://localhost:5173. Drives the
// installed Chrome headless through playwright-core, with reduced motion:
// the stylesheet's 120ms transitions would otherwise show a just-changed
// colour as the old one. The page is custom-properties.html: the package
// stylesheet and nothing else of the app's. Submits are answered here
// (page.route), so no API is needed.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const BASE = 'http://localhost:5173/external-test-app/custom-properties.html';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';

/** Every property the stylesheet sets from a custom property, and the ones around them. */
const PROPS = [
  'color', 'background-color', 'background-image',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-left-radius', 'border-top-right-radius', 'border-bottom-left-radius', 'border-bottom-right-radius',
  'box-shadow', 'outline-color', 'outline-style', 'outline-width', 'outline-offset',
  'accent-color', 'color-scheme', 'opacity', 'text-decoration-color',
  'font-family', 'font-size', 'font-weight', 'line-height', 'text-align', 'display',
  'min-height', 'min-width', 'max-width',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'row-gap', 'column-gap', 'content',
];

const THEMES = ['light', 'dark'];
const DENSITIES = ['none', 'patient', 'standard', 'dense'];
// Where the host puts data-zf-theme and data-zf-density: on a wrapper around
// the form, or on the form's roots themselves (.zf-form, .zf-success, .zf-scores).
const PLACEMENTS = ['wrapper', 'root'];

// ---------------------------------------------------------------- probes

/** [name, selector, pseudo?] — the first element matching selector. */
const FORM = [
  ['form', '.zf-form'],
  ['title', '.zf-title'],
  ['display-text', '.zf-display-text'],
  ['heading', '.zf-heading'],
  ['text', '.zf-text'],
  ['divider', '.zf-divider'],
  ['label', '.zf-label'],
  ['required-marker', '.zf-required', '::after'],
  ['help', '.zf-help'],
  ['input', '.zf-block--short .zf-input'],
  ['textarea', '.zf-textarea'],
  ['select', '.zf-block--dropdown .zf-select'],
  ['option', '.zf-block--choice .zf-option'],
  ['option-input', '.zf-block--choice .zf-option-input'],
  ['scale-option', '.zf-block--scale .zf-option'],
  ['rating-star', '.zf-rating-star'],
  ['ranking-item', '.zf-ranking-item'],
  ['ranking-position', '.zf-ranking-position'],
  ['matrix', '.zf-matrix'],
  ['matrix-head', '.zf-matrix thead th'],
  ['matrix-row-label', '.zf-matrix tbody th, .zf-matrix-row td:first-child'],
  ['matrix-cell', '.zf-matrix-row td'],
  ['matrix-input', '.zf-matrix-cell input'],
  ['group', '.zf-group'],
  ['group-nested', '.zf-group .zf-group'],
  ['group-heading', '.zf-group-legend > *'],
  ['repeat-instance', '.zf-repeat-instance'],
  ['repeat-heading', '.zf-repeat-legend > *'],
  ['repeat-add', '.zf-repeat-add'],
  ['grid-scroll', '.zf-grid-scroll'],
  ['grid', '.zf-grid'],
  ['grid-corner', '.zf-grid thead td'],
  ['grid-col-head', '.zf-grid thead th'],
  ['grid-row-head', '.zf-grid tbody th'],
  ['grid-cell', '.zf-grid-cell'],
  ['grid-input', '.zf-grid-cell .zf-input'],
  ['grid-select', '.zf-grid-cell .zf-select'],
  ['grid-radiogroup', '.zf-grid-cell > [role="radiogroup"]'],
  ['grid-radio', '.zf-grid-cell input[type="radio"]'],
  ['grid-cell-label', '.zf-grid-cell-label'],
  ['actions', '.zf-actions'],
  ['submit', '.zf-submit'],
  ['clear', '.zf-clear'],
];
const FOCUS = [
  ['input', '.zf-block--short .zf-input'],
  ['textarea', '.zf-textarea'],
  ['select', '.zf-block--dropdown .zf-select'],
  ['option', '.zf-block--choice .zf-option'],
  ['option-input', '.zf-block--choice .zf-option-input'],
  ['scale-option', '.zf-block--scale .zf-option'],
  ['rating-star', '.zf-rating-star'],
  ['ranking-item', '.zf-ranking-item'],
  ['matrix-input', '.zf-matrix-cell input'],
  ['repeat-add', '.zf-repeat-add'],
  ['grid-scroll', '.zf-grid-scroll'],
  ['submit', '.zf-submit'],
];
const SELECTED = [
  ['option', '.zf-block--choice .zf-option:has(:checked)'],
  ['option-unselected', '.zf-block--choice .zf-option:not(:has(:checked))'],
  ['scale-option', '.zf-block--scale .zf-option:has(:checked)'],
  ['rating-star', '.zf-rating-star--selected'],
  ['ranking-item', '.zf-ranking-item--ranked'],
  ['ranking-position', '.zf-ranking-item--ranked .zf-ranking-position'],
  ['matrix-input', '.zf-matrix-cell input:checked'],
  ['grid-radio', '.zf-grid-cell input[type="radio"]:checked'],
];
const ERROR = [
  ['summary', '.zf-error-summary'],
  ['summary-title', '.zf-error-summary-title'],
  ['summary-link', '.zf-error-summary-list a'],
  ['invalid-block', '.zf-block--invalid.zf-block--short'],
  ['invalid-fieldset', 'fieldset.zf-block--invalid'],
  ['invalid-input', '.zf-block--invalid .zf-input'],
  ['invalid-select', '.zf-block--invalid.zf-block--dropdown .zf-select'],
  ['error', '.zf-error'],
  ['error-message', '.zf-error-message'],
  ['error-glyph', '.zf-error-message', '::before'],
  ['required-marker', '.zf-required', '::after'],
  ['grid-invalid-select', '.zf-grid-cell--invalid .zf-select'],
  ['grid-valid-input', '.zf-grid-cell:not(.zf-grid-cell--invalid) .zf-input'],
];
const FAILED = [
  ['status', '.zf-status'],
  ['status-glyph', '.zf-status', '::before'],
  ['form', '.zf-form'],
];
const SUCCESS = [
  ['success', '.zf-success'],
  ['success-glyph', '.zf-success', '::before'],
  ['scores', '.zf-scores'],
  ['score', '.zf-scores > li'],
];
const GRID_NARROW = [
  ['grid', '.zf-grid'],
  ['grid-head', '.zf-grid > thead'],
  ['grid-card', '.zf-grid-card'],
  ['grid-card-next', '.zf-grid-card + .zf-grid-card'],
  ['grid-card-heading', '.zf-grid-card > th'],
  ['grid-cell', '.zf-grid-card > .zf-grid-cell'],
  ['grid-cell-label', '.zf-grid-cell-label'],
  ['grid-input', '.zf-grid-cell .zf-input'],
  ['grid-select', '.zf-grid-cell .zf-select'],
  ['grid-radiogroup', '.zf-grid-cell > [role="radiogroup"]'],
];
const PAGED = [
  ['form', '.zf-form'],
  ['progress-bar', '.zf-progress-bar'],
  ['segment-complete', '.zf-progress-segment--complete'],
  ['segment-current', '.zf-progress-segment--current'],
  ['segment-pending', '.zf-progress-segment:not(.zf-progress-segment--complete):not(.zf-progress-segment--current)'],
  ['progress', '.zf-progress'],
  ['page', '.zf-page'],
  ['page-title', '.zf-page-title'],
  ['group', '.zf-group'],
  ['nav', '.zf-nav'],
  ['back', '.zf-back'],
  ['next', '.zf-next'],
];
const REVIEW = [
  ['review', '.zf-review'],
  ['review-title', '.zf-review-title'],
  ['section', '.zf-review-section'],
  ['section-heading', '.zf-review-section h3'],
  ['change', '.zf-review-change'],
  ['group', '.zf-review-group'],
  ['group-heading', '.zf-review-section :is(h4, h5, h6)'],
  ['question', '.zf-review-question'],
  ['question-term', '.zf-review-question > dt'],
  ['answer', '.zf-review-answer'],
  ['submit', '.zf-submit'],
];
const BOXED = [
  ['group-root', '.zf-group--root'],
  ['group-nested', '.zf-group--root .zf-group'],
  ['repeat-instance', '.zf-repeat-instance'],
  ['invalid-in-box', '.zf-group--root > .zf-block--invalid'],
];

// ---------------------------------------------------------------- page helpers

/** In the page: the computed PROPS of each probe; a missing probe is null. */
function measure([probes, props]) {
  const out = {};
  for (const [name, selector, pseudo] of probes) {
    const element = document.querySelector(selector);
    if (!element) {
      out[name] = null;
      continue;
    }
    const style = getComputedStyle(element, pseudo ?? null);
    out[name] = Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop)]));
  }
  return out;
}

/** In the page: puts the theme and density attributes where the combination says. */
function place({ theme, density, placement, groupStyle }) {
  const targets =
    placement === 'wrapper'
      ? [document.getElementById('wrapper')]
      : [...document.querySelectorAll('.zf-form, .zf-success, .zf-scores')];
  for (const target of targets) {
    if (theme === 'dark') target.setAttribute('data-zf-theme', 'dark');
    if (density !== 'none') target.setAttribute('data-zf-density', density);
  }
  // Group style is always a wrapper's: the stylesheet reads it from an ancestor.
  if (groupStyle) document.getElementById('wrapper').setAttribute('data-zf-group-style', groupStyle);
}

/** Opens a fixture with the combination's attributes, and the host's own CSS if any. */
async function open(page, combo, { fixture = 'single', width = null, hostCss = null } = {}) {
  const query = new URLSearchParams({ fixture, ...(width ? { width: String(width) } : {}) });
  await page.goto(`${BASE}?${query}`);
  await page.waitForSelector('.zf-form');
  await page.evaluate(place, combo);
  if (hostCss) await page.addStyleTag({ content: hostCss });
  await page.mouse.move(0, 0);
}

/** Fills every required answer of the single fixture. */
async function fillRequired(page) {
  await page.locator('.zf-block--short .zf-input').first().fill('Ada');
  await page.locator('.zf-block--dropdown .zf-select').selectOption('north');
  await page.locator('.zf-block--choice .zf-option').nth(1).click();
  for (const select of await page.locator('.zf-grid-cell .zf-select').all()) await select.selectOption('never');
}

/** Tabs until the focused element matches selector; fails after limit presses. */
async function tabTo(page, selector, limit = 60) {
  for (let i = 0; i < limit; i += 1) {
    await page.keyboard.press('Tab');
    if (await page.evaluate((s) => document.activeElement?.matches(s) ?? false, selector)) return;
  }
  throw new Error(`never focused ${selector}`);
}

// ---------------------------------------------------------------- states

/** Each state: how to reach it, and what to measure there. */
const STATES = {
  default: {
    probes: FORM,
    async reach(page, combo) {
      await open(page, combo);
    },
  },
  'focus-visible': {
    // Measured one at a time, each while it has keyboard focus.
    async run(page, combo) {
      await open(page, combo);
      const out = {};
      const targets = [
        ['input', '.zf-block--short .zf-input'],
        ['textarea', '.zf-textarea'],
        ['select', '.zf-block--dropdown .zf-select'],
        ['option', '.zf-block--choice .zf-option-input'],
        ['scale-option', '.zf-block--scale .zf-option-input'],
        ['rating-star', '.zf-rating-star'],
        ['ranking-item', '.zf-ranking-item'],
        ['matrix-input', '.zf-matrix-cell input'],
        ['repeat-add', '.zf-repeat-add'],
        ['grid-scroll', '.zf-grid-scroll'],
        ['submit', '.zf-submit'],
      ];
      for (const [name, selector] of targets) {
        await tabTo(page, selector);
        const probes = FOCUS.filter(([probe]) => probe === name || (name === 'option' && probe === 'option-input'));
        Object.assign(out, await page.evaluate(measure, [probes, PROPS]));
      }
      return out;
    },
  },
  'selected-option': {
    probes: SELECTED,
    async reach(page, combo) {
      await open(page, combo);
      await page.locator('.zf-block--choice .zf-option').nth(1).click();
      await page.locator('.zf-block--scale .zf-option').nth(2).click();
      await page.locator('.zf-rating-star').nth(2).click();
      await page.locator('.zf-ranking-item').first().click();
      await page.locator('.zf-matrix-cell input').first().click();
      await page.locator('.zf-grid-cell input[type="radio"]').first().click();
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
    },
  },
  error: {
    probes: ERROR,
    async reach(page, combo) {
      await open(page, combo);
      await page.locator('.zf-submit').click();
      await page.waitForSelector('.zf-error-summary');
      await page.mouse.move(0, 0);
    },
  },
  'submit-failed': {
    probes: FAILED,
    async reach(page, combo) {
      await page.route('**/custom-properties-submit', (route) => route.fulfill({ status: 500, body: 'no' }));
      await open(page, combo);
      await fillRequired(page);
      await page.locator('.zf-submit').click();
      await page.waitForSelector('.zf-status');
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
    },
  },
  success: {
    probes: SUCCESS,
    async reach(page, combo) {
      await page.route('**/custom-properties-submit', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
      );
      await open(page, combo);
      await fillRequired(page);
      await page.locator('.zf-submit').click();
      await page.waitForSelector('.zf-scores');
      // The form is gone: a host that themes the roots themselves themes these.
      await page.evaluate(place, combo);
    },
  },
  'grid-narrow': {
    probes: GRID_NARROW,
    async reach(page, combo) {
      await open(page, combo, { width: 400 });
    },
  },
  paged: {
    probes: PAGED,
    async reach(page, combo) {
      await open(page, combo, { fixture: 'paged' });
      await page.locator('.zf-next').click();
      await page.waitForSelector('.zf-group');
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
    },
  },
  review: {
    probes: REVIEW,
    async reach(page, combo) {
      await open(page, combo, { fixture: 'paged' });
      await page.locator('.zf-block--short .zf-input').fill('One');
      await page.locator('.zf-next').click();
      await page.locator('.zf-block--short .zf-input').fill('Two');
      await page.locator('.zf-next').click();
      await page.locator('.zf-next').click();
      await page.waitForSelector('.zf-review');
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
    },
  },
  boxed: {
    probes: BOXED,
    async reach(page, combo) {
      await open(page, { ...combo, groupStyle: 'box' });
      await page.locator('.zf-submit').click();
      await page.waitForSelector('.zf-error-summary');
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(0, 0);
    },
  },
  'boxed-narrow-viewport': {
    viewport: { width: 375, height: 900 },
    probes: BOXED,
    async reach(page, combo) {
      await STATES.boxed.reach(page, combo);
    },
  },
};

// ---------------------------------------------------------------- run

/**
 * Refuses to measure a stale page: the dev server must serve the package
 * version expected, and (requirePrivate) a stylesheet with --_zf- in it.
 */
async function preflight(browser, { version, requirePrivate }) {
  const page = await browser.newPage();
  await page.goto(BASE);
  await page.waitForSelector('.zf-form');
  const served = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('style[data-vite-dev-id], link[rel="stylesheet"]')].filter((node) =>
      (node.getAttribute('data-vite-dev-id') ?? node.getAttribute('href') ?? '').includes('@zoworkhq/forms')
    );
    const text = sheets.map((node) => [...(node.sheet?.cssRules ?? [])].map((rule) => rule.cssText).join('\n')).join('\n');
    return {
      version: document.documentElement.dataset.zfPackageVersion ?? null,
      sheets: sheets.length,
      private: text.includes('--_zf-'),
    };
  });
  await page.close();
  const stale = 'Restart the dev server with node_modules/.vite cleared, after installing the package.';
  if (served.version !== version)
    throw new Error(`The page reports @zoworkhq/forms ${served.version}, not ${version}. ${stale}`);
  if (served.sheets === 0) throw new Error('The page has no @zoworkhq/forms stylesheet.');
  if (requirePrivate && !served.private)
    throw new Error(`The served @zoworkhq/forms stylesheet has no --_zf- properties. ${stale}`);
  console.log(`preflight: the page serves @zoworkhq/forms ${served.version}${requirePrivate ? ', stylesheet with --_zf-' : ''}`);
}

async function measureAll(browser) {
  const results = {};
  for (const placement of PLACEMENTS)
    for (const theme of THEMES)
      for (const density of DENSITIES)
        for (const [state, spec] of Object.entries(STATES)) {
          const context = await browser.newContext({
            viewport: spec.viewport ?? { width: 1280, height: 900 },
            reducedMotion: 'reduce',
          });
          const page = await context.newPage();
          const combo = { theme, density, placement };
          let values;
          if (spec.run) values = await spec.run(page, combo);
          else {
            await spec.reach(page, combo);
            values = await page.evaluate(measure, [spec.probes, PROPS]);
          }
          results[`${placement}/${theme}/${density}/${state}`] = values;
          await context.close();
        }
  return results;
}

/** The results by placement, each keyed "theme/density/state probe". */
function byPlacement(results) {
  const out = Object.fromEntries(PLACEMENTS.map((p) => [p, {}]));
  for (const [key, probes] of Object.entries(results)) {
    const [placement, ...rest] = key.split('/');
    for (const [probe, values] of Object.entries(probes)) out[placement][`${rest.join('/')} ${probe}`] = values;
  }
  return out;
}

/** Every value under `a` that differs in `b`, as "probe prop: a → b". */
function differences(a, b) {
  const out = [];
  for (const [probe, values] of Object.entries(a)) {
    const other = b[probe];
    if (values === null || other === null || other === undefined) {
      if (values !== other) out.push(`${probe}: ${values === null ? 'missing' : 'present'} → ${other == null ? 'missing' : 'present'}`);
      continue;
    }
    for (const [prop, value] of Object.entries(values))
      if (other[prop] !== value) out.push(`${probe} ${prop}: ${value} → ${other[prop]}`);
  }
  for (const probe of Object.keys(b)) if (!(probe in a)) out.push(`${probe}: not in the baseline`);
  return out;
}

// ---------------------------------------------------------------- check: results

let failures = 0;
const failed = [];
/** One named group of checks: a PASS line with its count, or each failure. */
function report(name, results) {
  const bad = results.filter((r) => !r.ok);
  failures += bad.length;
  console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${name} (${results.length - bad.length}/${results.length})`);
  for (const r of bad.slice(0, 30)) console.log(`        ${r.what}: got ${r.actual}, expected ${r.expected}`);
  if (bad.length > 30) console.log(`        … and ${bad.length - 30} more`);
  if (bad.length) failed.push(name);
}
const expectValue = (what, actual, expected) => ({ ok: actual === expected, what, actual, expected });

/** A colour as "r, g, b[, a]" in 0–255, whether Chrome gives rgb() or color(srgb …). */
function rgb(value) {
  const srgb = /^color\(srgb ([\d.e-]+) ([\d.e-]+) ([\d.e-]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((n) => Math.round(Number(n) * 255));
    return srgb[4] !== undefined && Number(srgb[4]) !== 1 ? `${r}, ${g}, ${b}, ${srgb[4]}` : `${r}, ${g}, ${b}`;
  }
  const plain = /^rgba?\(([^)]*)\)$/.exec(value);
  return plain ? plain[1].split(',').map((n) => n.trim()).join(', ') : value;
}

/** In the page: one computed property of the first match (pseudo optional), or null. */
function styleOf([selector, prop, pseudo]) {
  const element = document.querySelector(selector);
  return element ? getComputedStyle(element, pseudo ?? null).getPropertyValue(prop) : null;
}
const read = (page, selector, prop, pseudo) => page.evaluate(styleOf, [selector, prop, pseudo]);

async function newPage(browser, viewport = { width: 1280, height: 900 }) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce' });
  const page = await context.newPage();
  await page.route('**/custom-properties-submit', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  );
  return page;
}

/** Submits the single fixture with every required answer, and re-places the attributes on the new roots. */
async function submit(page, combo) {
  await fillRequired(page);
  await page.locator('.zf-submit').click();
  await page.waitForSelector('.zf-scores');
  await page.evaluate(place, combo);
}

// ---------------------------------------------------------------- check: suites

const LIGHT_PRIMARY = '15, 92, 74';
const DARK_PRIMARY = '93, 191, 165';

/** Host values for the main suite: a colour, a spacing value, the focus ring, and two the scores list reads. */
const HOST = {
  '--zf-primary': 'rgb(200, 30, 120)',
  '--zf-spacing': '13px',
  '--zf-focus-ring': 'rgb(240, 130, 0)',
  '--zf-text-color': 'rgb(20, 40, 160)',
  '--zf-max-width': '600px',
};
/** Where a host sets its values: :root, a wrapper, or the roots themselves. */
const HOST_AT = { ':root': ':root', wrapper: '#wrapper', roots: '.zf-form, .zf-success, .zf-scores' };
const cssFor = (selector, values) =>
  `${selector} { ${Object.entries(values).map(([name, value]) => `${name}: ${value};`).join(' ')} }`;

/** Nothing set: every theme × density × state, both placements, equal to the baseline. */
async function checkBaseline(browser, baselineFile) {
  const baseline = JSON.parse(readFileSync(baselineFile, 'utf8')).values;
  const now = byPlacement(await measureAll(browser));
  for (const placement of PLACEMENTS) {
    const diffs = differences(baseline, now[placement]);
    const total = Object.keys(baseline).length;
    report(
      `nothing set equals the 0.25.0 baseline, theme and density on ${placement === 'root' ? 'the roots' : 'a wrapper'} (${total} probes × ${PROPS.length} properties)`,
      diffs.length ? diffs.map((d) => ({ ok: false, what: d, actual: 'differs', expected: 'baseline' })) : [{ ok: true }]
    );
  }
}

/** Each host value, set on :root, a wrapper and the roots, reaches the form, the success message and the scores list. */
async function checkHostValues(browser) {
  for (const [at, selector] of Object.entries(HOST_AT)) {
    const results = [];
    for (const placement of PLACEMENTS)
      for (const theme of THEMES)
        for (const density of DENSITIES) {
          const combo = { theme, density, placement };
          const label = `${theme}, ${density} density, theme on ${placement}`;
          const page = await newPage(browser);
          await open(page, combo, { hostCss: cssFor(selector, HOST) });
          // A form control and the form around it.
          results.push(expectValue(`${label}: Submit background`, rgb(await read(page, '.zf-submit', 'background-color')), '200, 30, 120'));
          results.push(expectValue(`${label}: form gap`, await read(page, '.zf-form', 'row-gap'), '13px'));
          results.push(expectValue(`${label}: group gap`, await read(page, '.zf-group', 'row-gap'), '13px'));
          results.push(expectValue(`${label}: label colour`, rgb(await read(page, '.zf-label', 'color')), '20, 40, 160'));
          results.push(expectValue(`${label}: form max-width`, await read(page, '.zf-form', 'max-width'), '600px'));
          await tabTo(page, '.zf-block--short .zf-input');
          results.push(expectValue(`${label}: input focus ring`, rgb(await read(page, '.zf-block--short .zf-input', 'outline-color')), '240, 130, 0'));
          await tabTo(page, '.zf-block--choice .zf-option-input');
          results.push(expectValue(`${label}: option tile focus ring`, rgb(await read(page, '.zf-block--choice .zf-option', 'outline-color')), '240, 130, 0'));
          // The success message and the scores list, which replace the form.
          await submit(page, combo);
          results.push(expectValue(`${label}: success bar`, rgb(await read(page, '.zf-success', 'border-left-color')), '200, 30, 120'));
          results.push(expectValue(`${label}: success ✓`, rgb(await read(page, '.zf-success', 'color', '::before')), '200, 30, 120'));
          results.push(expectValue(`${label}: success text`, rgb(await read(page, '.zf-success', 'color')), '20, 40, 160'));
          results.push(expectValue(`${label}: success max-width`, await read(page, '.zf-success', 'max-width'), '600px'));
          results.push(expectValue(`${label}: scores text`, rgb(await read(page, '.zf-scores', 'color')), '20, 40, 160'));
          results.push(expectValue(`${label}: scores max-width`, await read(page, '.zf-scores', 'max-width'), '600px'));
          await page.context().close();
        }
    report(`host values on ${at}: colour, spacing, focus ring, text colour, max-width — every theme × density × placement`, results);
  }
}

/** A value on the roots beats a wrapper's, which beats :root's. */
async function checkOrder(browser) {
  const results = [];
  const layers = [
    { name: ':root, wrapper and roots', css: [':root', '#wrapper', HOST_AT.roots], expected: '0, 0, 255' },
    { name: ':root and wrapper', css: [':root', '#wrapper'], expected: '0, 255, 0' },
    { name: ':root only', css: [':root'], expected: '255, 0, 0' },
  ];
  const colours = { ':root': 'rgb(255, 0, 0)', '#wrapper': 'rgb(0, 255, 0)', [HOST_AT.roots]: 'rgb(0, 0, 255)' };
  for (const combo of [
    { theme: 'light', density: 'none', placement: 'wrapper' },
    { theme: 'dark', density: 'dense', placement: 'wrapper' },
    { theme: 'dark', density: 'patient', placement: 'root' },
  ])
    for (const layer of layers) {
      const page = await newPage(browser);
      const css = layer.css.map((selector) => cssFor(selector, { '--zf-primary': colours[selector] })).join('\n');
      await open(page, combo, { hostCss: css });
      const label = `${combo.theme}, ${combo.density}, theme on ${combo.placement}, set on ${layer.name}`;
      results.push(expectValue(`${label}: Submit`, rgb(await read(page, '.zf-submit', 'background-color')), layer.expected));
      await submit(page, combo);
      results.push(expectValue(`${label}: success bar`, rgb(await read(page, '.zf-success', 'border-left-color')), layer.expected));
      await page.context().close();
    }
  report('order: roots beat a wrapper, which beats :root', results);
}

/** The README's dark-only override: the host's own dark selector, applied in dark only. */
async function checkDarkOnly(browser) {
  const results = [];
  const css = '[data-zf-theme="dark"] { --zf-primary: rgb(180, 140, 242); }';
  for (const combo of [
    { theme: 'light', density: 'none', placement: 'wrapper', expected: LIGHT_PRIMARY },
    { theme: 'dark', density: 'none', placement: 'wrapper', expected: '180, 140, 242' },
    { theme: 'dark', density: 'standard', placement: 'root', expected: '180, 140, 242' },
  ]) {
    const page = await newPage(browser);
    await open(page, combo, { hostCss: css });
    const label = `${combo.theme}, theme on ${combo.placement}`;
    results.push(expectValue(`${label}: Submit`, rgb(await read(page, '.zf-submit', 'background-color')), combo.expected));
    await submit(page, combo);
    results.push(expectValue(`${label}: success bar`, rgb(await read(page, '.zf-success', 'border-left-color')), combo.expected));
    await page.context().close();
  }
  report('a dark-only override applies in dark, not in light', results);
}

/** Derived properties follow a host's base colours set on :root. */
async function checkDerived(browser) {
  const results = [];
  // Every input of each derivation the same colour, so the mix is that colour.
  const css = ':root { --zf-primary: rgb(255, 0, 0); --zf-control-border: rgb(255, 0, 0); --zf-surface: rgb(255, 0, 0); }';
  for (const theme of THEMES) {
    const page = await newPage(browser);
    await open(page, { theme, density: 'none', placement: 'wrapper' }, { fixture: 'paged', hostCss: css });
    await page.locator('.zf-next').click();
    await page.waitForSelector('.zf-group');
    for (const [what, selector, prop] of [
      ['current segment (= primary)', '.zf-progress-segment--current', 'background-color'],
      ['complete segment (primary mixed with surface)', '.zf-progress-segment--complete', 'background-color'],
      ['pending segment (= control border)', '.zf-progress-segment:not(.zf-progress-segment--complete):not(.zf-progress-segment--current)', 'border-top-color'],
      ['group rule (control border mixed with surface)', '.zf-group', 'border-left-color'],
    ])
      results.push(expectValue(`${theme}: ${what}`, rgb(await read(page, selector, prop)), '255, 0, 0'));
    await page.context().close();
  }
  report('derived properties follow host values on :root', results);
}

/** An invalid host value doesn't fall back to the package default (as in 0.25.0). */
async function checkInvalid(browser) {
  const results = [];
  for (const [at, selector] of Object.entries(HOST_AT)) {
    const page = await newPage(browser);
    await open(page, { theme: 'light', density: 'none', placement: 'wrapper' }, { hostCss: `${selector} { --zf-primary: banana; }` });
    const background = rgb(await read(page, '.zf-submit', 'background-color'));
    results.push({ ok: background !== LIGHT_PRIMARY, what: `banana on ${at}: Submit background is not the default`, actual: background, expected: `not ${LIGHT_PRIMARY}` });
    // background-color is invalid at computed-value time, so it takes its initial value.
    results.push(expectValue(`banana on ${at}: Submit background is the initial value`, background, '0, 0, 0, 0'));
    await page.context().close();
  }
  report('an invalid value does not fall back to the package default', results);
}

/** The documented change: a value set on an element inside the form no longer applies. */
async function checkInside(browser) {
  const results = [];
  for (const combo of [
    { theme: 'light', density: 'none', placement: 'wrapper', expected: '158, 27, 18' },
    { theme: 'dark', density: 'none', placement: 'wrapper', expected: '255, 141, 128' },
  ]) {
    const page = await newPage(browser);
    await open(page, combo, { hostCss: '.zf-error-summary { --zf-error: rgb(0, 128, 0); }' });
    await page.locator('.zf-submit').click();
    await page.waitForSelector('.zf-error-summary');
    results.push(expectValue(`${combo.theme}: error summary bar keeps the default`, rgb(await read(page, '.zf-error-summary', 'border-left-color')), combo.expected));
    await page.context().close();
  }
  report('a value set inside the form (.zf-error-summary) no longer applies', results);
}

/** A form themed from :root, as the README shows, in light and dark. */
async function screenshots(browser, dir) {
  mkdirSync(dir, { recursive: true });
  const css = `:root { --zf-primary: #6b2fb3; --zf-primary-soft: #f1eafa; --zf-focus-ring: #6b2fb3; }
[data-zf-theme="dark"] { --zf-primary: #b48cf2; --zf-primary-soft: #241a33; --zf-focus-ring: #b48cf2; }`;
  for (const theme of THEMES) {
    const page = await newPage(browser, { width: 760, height: 900 });
    await open(page, { theme, density: 'none', placement: 'wrapper' }, { hostCss: css });
    if (theme === 'dark') await page.evaluate(() => (document.body.style.background = '#0d1114'));
    await page.locator('.zf-block--choice .zf-option').nth(2).click();
    await page.locator('.zf-rating-star').nth(3).click();
    await page.locator('.zf-ranking-item').nth(1).click();
    await page.locator('.zf-block--short .zf-input').first().fill('Ada Lovelace');
    await page.locator('.zf-block--short .zf-input').first().focus();
    await page.keyboard.press('End');
    const file = join(dir, `root-themed-${theme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    console.log(`screenshot: ${file}`);
    await page.context().close();
  }
}

// ---------------------------------------------------------------- main

const args = process.argv.slice(2);
const [mode, file] = args;
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? null : args[index + 1] ?? null;
};
const version = option('--version');
if (!['baseline', 'check'].includes(mode) || !file || !version) {
  console.error('usage: node scripts/custom-properties-check.mjs baseline <out.json> --version <x.y.z>');
  console.error('       node scripts/custom-properties-check.mjs check <baseline.json> --version <x.y.z> [--screenshots <dir>]');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
try {
  await preflight(browser, { version, requirePrivate: mode === 'check' });

  if (mode === 'baseline') {
    const results = byPlacement(await measureAll(browser));
    const placementDiffs = differences(results.wrapper, results.root);
    const missing = Object.entries(results.wrapper).filter(([, values]) => values === null).map(([probe]) => probe);
    // One line per probe, so a diff of the file reads probe by probe.
    const lines = Object.entries(results.wrapper).map(([probe, values]) => `    ${JSON.stringify(probe)}: ${JSON.stringify(values)}`);
    const header = {
      package: `@zoworkhq/forms ${version} (installed in the external test app)`,
      chrome: browser.version(),
      viewport: '1280×900 (boxed-narrow-viewport: 375×900); reduced motion',
      themes: THEMES,
      densities: DENSITIES,
      states: Object.keys(STATES),
      placementsCompared: PLACEMENTS,
      placementDifferences: placementDiffs.length,
    };
    writeFileSync(file, `{\n  "meta": ${JSON.stringify(header)},\n  "values": {\n${lines.join(',\n')}\n  }\n}\n`);
    console.log(`chrome ${browser.version()}`);
    console.log(`${lines.length} probes; missing: ${missing.length}`);
    for (const probe of missing) console.log(`  ${probe}`);
    console.log(`wrapper vs root placement differences: ${placementDiffs.length}`);
    for (const line of placementDiffs.slice(0, 40)) console.log(`  ${line}`);
    console.log(`wrote ${file}`);
  } else {
    console.log(`chrome ${browser.version()}`);
    await checkBaseline(browser, file);
    await checkHostValues(browser);
    await checkOrder(browser);
    await checkDarkOnly(browser);
    await checkDerived(browser);
    await checkInvalid(browser);
    await checkInside(browser);
    const dir = option('--screenshots');
    if (dir) await screenshots(browser, dir);
    console.log(failures ? `\n${failures} failure(s) in: ${failed.join('; ')}` : '\nall checks passed');
    process.exitCode = failures ? 1 : 0;
  }
} catch (error) {
  console.error(`\n${error.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

// Computed styles of the package stylesheet in a real browser, for the
// custom-properties work in @zoworkhq/forms (renderer brief
// RENDERER-BRIEF-CUSTOM-PROPERTIES.md).
//
//   node scripts/custom-properties-check.mjs baseline <out.json>
//     Measures every theme × density × state with no host custom properties
//     set, and writes the result. Run against 0.25.0 to make the baseline.
//
// Needs the dev server (npx vite) on http://localhost:5173. Drives the
// installed Chrome headless through playwright-core. The page is
// custom-properties.html: the package stylesheet and nothing else of the
// app's. Submits are answered here (page.route), so no API is needed.
import { writeFileSync } from 'node:fs';
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

async function open(page, combo, { fixture = 'single', width = null } = {}) {
  const query = new URLSearchParams({ fixture, ...(width ? { width: String(width) } : {}) });
  await page.goto(`${BASE}?${query}`);
  await page.waitForSelector('.zf-form');
  await page.evaluate(place, combo);
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

/** Every value under `a` that differs in `b`, as "key probe prop: a → b". */
function differences(a, b) {
  const out = [];
  for (const [key, probes] of Object.entries(a))
    for (const [probe, values] of Object.entries(probes)) {
      const other = b[key]?.[probe];
      if (values === null || other === null || other === undefined) {
        if (values !== other) out.push(`${key} ${probe}: ${values === null ? 'missing' : 'present'} → ${other == null ? 'missing' : 'present'}`);
        continue;
      }
      for (const [prop, value] of Object.entries(values))
        if (other[prop] !== value) out.push(`${key} ${probe} ${prop}: ${value} → ${other[prop]}`);
    }
  return out;
}

const [mode, file] = process.argv.slice(2);
if (mode !== 'baseline' || !file) {
  console.error('usage: node scripts/custom-properties-check.mjs baseline <out.json>');
  process.exit(2);
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const results = await measureAll(browser);
const version = browser.version();
await browser.close();

// The two placements must agree: split them, and keep the wrapper's as the baseline.
const byPlacement = Object.fromEntries(PLACEMENTS.map((p) => [p, {}]));
for (const [key, value] of Object.entries(results)) {
  const [placement, ...rest] = key.split('/');
  byPlacement[placement][rest.join('/')] = value;
}
const placementDiffs = differences(byPlacement.wrapper, byPlacement.root);

const missing = [];
for (const [key, probes] of Object.entries(byPlacement.wrapper))
  for (const [probe, values] of Object.entries(probes)) if (values === null) missing.push(`${key} ${probe}`);

// One line per probe, so a diff of the file reads probe by probe.
const lines = Object.entries(byPlacement.wrapper).flatMap(([key, probes]) =>
  Object.entries(probes).map(([probe, values]) => `    ${JSON.stringify(`${key} ${probe}`)}: ${JSON.stringify(values)}`)
);
const header = {
  package: '@zoworkhq/forms (installed in the external test app)',
  chrome: version,
  viewport: '1280×900 (boxed-narrow-viewport: 375×900); reduced motion',
  themes: THEMES,
  densities: DENSITIES,
  states: Object.keys(STATES),
  placementsCompared: PLACEMENTS,
  placementDifferences: placementDiffs.length,
};
writeFileSync(
  file,
  `{\n  "meta": ${JSON.stringify(header)},\n  "values": {\n${lines.join(',\n')}\n  }\n}\n`
);

console.log(`chrome ${version}`);
console.log(`${Object.keys(byPlacement.wrapper).length} theme × density × state combinations, ${lines.length} probes`);
console.log(`missing probes: ${missing.length}`);
for (const line of missing) console.log(`  ${line}`);
console.log(`wrapper vs root placement differences: ${placementDiffs.length}`);
for (const line of placementDiffs.slice(0, 40)) console.log(`  ${line}`);
console.log(`wrote ${file}`);

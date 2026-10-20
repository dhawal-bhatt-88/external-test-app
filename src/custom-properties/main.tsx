// The custom-properties check page (scripts/custom-properties-check.mjs).
// A bare host: the package stylesheet and nothing else of the app's, so every
// computed value comes from the package. The script sets the theme, density
// and group-style attributes, and any host custom properties, itself — on
// #wrapper, on the form's roots, or on :root.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { FormRenderer } from '@zoworkhq/forms/react';
import type { FormSchema } from '@zoworkhq/forms/core';
import '@zoworkhq/forms/styles.css';
import single from './single-schema.json';
import paged from './paged-schema.json';

const FIXTURES = { single, paged } as const;
const params = new URLSearchParams(location.search);
const fixture = FIXTURES[(params.get('fixture') ?? 'single') as keyof typeof FIXTURES] ?? single;
// The grid's card layout: the form in a panel narrower than the grid's 34rem breakpoint.
const panelWidth = Number(params.get('width')) || null;

document.body.style.margin = '0';
document.body.style.padding = '16px';
document.body.style.font = '16px/1.5 Arial, sans-serif';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div id="wrapper">
      <div id="panel" style={panelWidth ? { width: `${panelWidth}px` } : undefined}>
        <FormRenderer schema={fixture as unknown as FormSchema} endpoint="/custom-properties-submit" />
      </div>
    </div>
  </StrictMode>,
);

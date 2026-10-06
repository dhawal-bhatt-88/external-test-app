// One-off, after convert-options.mjs: the fixtures whose options became coded
// changed shape, so each gets a new formVersionId (its old one plus "-coded").
// A stale draft or tab entry saved against the old version is then never
// restored into the new one. Safe to run twice.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const FORMS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'forms');
const CODED = new Set(['choice', 'dropdown', 'checkbox', 'multiselect', 'ranking', 'matrix']);
const SUFFIX = '-coded';

function* walk(blocks) {
  for (const block of blocks) {
    yield block;
    if (Array.isArray(block.blocks)) yield* walk(block.blocks);
  }
}

for (const file of readdirSync(FORMS_DIR).filter((name) => name.endsWith('.json')).sort()) {
  const path = resolve(FORMS_DIR, file);
  const text = readFileSync(path, 'utf8');
  const schema = JSON.parse(text);
  const coded = [...walk(schema.blocks)].some((block) => CODED.has(block.type) && Array.isArray(block.options));
  if (!coded) {
    console.log(`${file}: no coded options, unchanged (${schema.formVersionId})`);
    continue;
  }
  if (schema.formVersionId.endsWith(SUFFIX)) {
    console.log(`${file}: already ${schema.formVersionId}`);
    continue;
  }
  const next = `${schema.formVersionId}${SUFFIX}`;
  // Only the formVersionId line changes, so the file's formatting is kept.
  const updated = text.replace(`"formVersionId": ${JSON.stringify(schema.formVersionId)}`, `"formVersionId": ${JSON.stringify(next)}`);
  if (updated === text) throw new Error(`${file}: formVersionId not found to replace`);
  writeFileSync(path, updated);
  console.log(`${file}: ${schema.formVersionId} -> ${next}`);
}

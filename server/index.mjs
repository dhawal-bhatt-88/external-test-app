// Local test API for @yourco/forms submissions. Not for production use.
import express from 'express';
import { createHmac, randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSchemaIntegrity, prepareSubmission } from '@yourco/forms/core';

const PORT = Number(process.env.PORT ?? 5000);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Must be the same file src/App.tsx imports, so client and server validate identically.
const SCHEMA_PATH = resolve(ROOT, process.env.FORM_SCHEMA ?? 'src/forms/phase7-pages-schema.json');
const STORE_PATH = resolve(ROOT, 'server/submissions.json');
const FORMS_DIR = resolve(ROOT, 'src/forms');
// Server-mode drafts, keyed by (scope, formId). A test stand-in for a host's own backend.
const DRAFTS_PATH = resolve(ROOT, 'server/drafts.json');
// Device-mode keys are derived from this and the user id, so a user's key is
// the same on every visit and different from every other user's.
const DRAFT_KEY_SECRET = process.env.DRAFT_KEY_SECRET ?? 'dev-only-draft-key-secret-do-not-use-in-production';
// Every request the API receives, one JSON object per line (JSON Lines).
const REQUEST_LOG_PATH = resolve(ROOT, process.env.API_LOG ?? 'api-requests.log');

// ---------------------------------------------------------------- schema

// Re-read on every request so re-publishing the schema file takes effect
// without a restart (and makes the version-mismatch path easy to exercise).
function loadSchema() {
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  assertSchemaIntegrity(schema);
  return schema;
}

// The schema a submission was built against: the configured one when the
// formId matches (or is missing), otherwise the fixture in src/forms with that
// formId, so the drafts fixtures validate against their own schemas.
function loadSchemaFor(formId) {
  const configured = loadSchema();
  if (!formId || configured.formId === formId) return configured;
  for (const file of readdirSync(FORMS_DIR).filter((f) => f.endsWith('.json'))) {
    const schema = JSON.parse(readFileSync(resolve(FORMS_DIR, file), 'utf8'));
    if (schema.formId === formId) {
      assertSchemaIntegrity(schema);
      return schema;
    }
  }
  return configured;
}

// ---------------------------------------------------------------- storage

function loadStore() {
  if (!existsSync(STORE_PATH)) return [];
  const parsed = JSON.parse(readFileSync(STORE_PATH, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

const submissions = loadStore();
// idempotencyKey -> stored record. Rebuilt from disk so dedup survives restarts.
const byIdempotencyKey = new Map(submissions.map((s) => [s.idempotencyKey, s]));

function persist() {
  // Write-then-rename so a crash mid-write can't leave a truncated file.
  const tmp = `${STORE_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(submissions, null, 2));
  renameSync(tmp, STORE_PATH);
}

// ---------------------------------------------------------------- failure simulation

const faults = { failNext: false, processThenFailNext: false, delayNextMs: 0, failNextDraftSave: false };

// ---------------------------------------------------------------- drafts

function loadDrafts() {
  if (!existsSync(DRAFTS_PATH)) return {};
  const parsed = JSON.parse(readFileSync(DRAFTS_PATH, 'utf8'));
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}
const drafts = loadDrafts();
const draftId = (scope, formId) => JSON.stringify([scope, formId]);
function persistDrafts() {
  const tmp = `${DRAFTS_PATH}.tmp`;
  writeFileSync(tmp, JSON.stringify(drafts, null, 2));
  renameSync(tmp, DRAFTS_PATH);
}

// ---------------------------------------------------------------- payload checks

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';

function isBlockValue(v) {
  return isPlainObject(v) && (v.state === 'empty' || (v.state === 'answered' && 'value' in v));
}

/** Returns a list of problems with the top-level payload shape; empty if OK. */
function checkShape(body) {
  if (!isPlainObject(body)) return ['body must be a JSON object'];
  const problems = [];
  for (const field of ['idempotencyKey', 'formId', 'formVersionId', 'submittedAt']) {
    if (!isNonEmptyString(body[field])) problems.push(`${field} is required and must be a non-empty string`);
  }
  if (isNonEmptyString(body.submittedAt) && Number.isNaN(Date.parse(body.submittedAt))) {
    problems.push('submittedAt must be an ISO-8601 timestamp');
  }
  if (body.schemaVersion !== undefined && typeof body.schemaVersion !== 'number') {
    problems.push('schemaVersion must be a number when present');
  }
  if (!isPlainObject(body.answers)) {
    problems.push('answers is required and must be an object');
  } else {
    for (const [blockId, value] of Object.entries(body.answers)) {
      if (!isBlockValue(value)) problems.push(`answers.${blockId} must be {state:'answered',value} or {state:'empty'}`);
    }
  }
  if (!isPlainObject(body.derived)) problems.push('derived is required and must be an object');
  return problems;
}

// ---------------------------------------------------------------- app

const app = express();

/**
 * Appends one request to REQUEST_LOG_PATH. body is the parsed JSON when it
 * parsed, otherwise the raw text exactly as received (e.g. malformed JSON).
 * A logging failure must never break the API, so errors only go to stderr.
 */
function writeRequestLog(req, res, extra) {
  const raw = req.rawBody;
  const entry = {
    receivedAt: new Date(res.locals.started).toISOString(),
    method: req.method,
    url: req.originalUrl,
    headers: { 'content-type': req.headers['content-type'], 'user-agent': req.headers['user-agent'] },
    body: req.body !== undefined ? req.body : raw || null,
    ...(req.body === undefined && raw ? { bodyParseFailed: true } : {}),
    ...extra,
    outcome: res.locals.note ?? null,
  };
  try {
    appendFileSync(REQUEST_LOG_PATH, JSON.stringify(entry) + '\n');
  } catch (err) {
    console.error(`  could not write ${REQUEST_LOG_PATH}: ${err.message}`);
  }
}

// One line per request: time, method, path, status, duration, plus any note a
// handler left in res.locals.note. Flags clients that hung up before we answered.
app.use((req, res, next) => {
  res.locals.started = Date.now();
  res.on('close', () => {
    const ms = Date.now() - res.locals.started;
    const note = res.locals.note ? `  ${res.locals.note}` : '';
    const line = `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${ms}ms)${note}`;
    if (!res.writableFinished) {
      // The file entry is written later by reply(), once the outcome is known.
      res.locals.disconnected = true;
      console.warn(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} !! client disconnected after ${ms}ms, before any response (still processing)`);
      return;
    }
    if (res.statusCode >= 400) console.warn(line);
    else console.log(line);
    writeRequestLog(req, res, { status: res.statusCode, durationMs: ms });
  });
  next();
});
// verify keeps the raw text so a body that fails to parse can still be logged.
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { req.rawBody = buf.toString('utf8'); } }));

// If the client already hung up (e.g. the form's timeout fired), the response
// goes nowhere and the request logger has already run - so log the outcome here.
function reply(res, status, body) {
  if (res.locals.disconnected) {
    console.warn(`  [late] would have returned ${status} ${JSON.stringify(body)}; response discarded.  ${res.locals.note ?? ''}`);
    writeRequestLog(res.req, res, {
      status,
      durationMs: Date.now() - res.locals.started,
      clientDisconnected: true,
      responseDiscarded: body,
    });
  }
  return res.status(status).json(body);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.post('/api/submit', async (req, res) => {
  const body = req.body;
  const key = isPlainObject(body) ? body.idempotencyKey : undefined;
  const tag = `key=${key ?? '?'}`;

  // Fault flags are consumed by the next submit, whatever its outcome.
  const { failNext, processThenFailNext, delayNextMs } = faults;
  faults.failNext = false;
  faults.processThenFailNext = false;
  faults.delayNextMs = 0;

  if (delayNextMs > 0) {
    console.log(`  [fault] delaying ${tag} by ${delayNextMs}ms before processing`);
    await sleep(delayNextMs);
  }

  if (failNext) {
    res.locals.note = `${tag} [fault] fail-next: not stored`;
    return reply(res, 500, { error: 'Simulated failure (fail-next); nothing was stored.' });
  }

  const problems = checkShape(body);
  if (problems.length > 0) {
    res.locals.note = `${tag} invalid payload: ${problems.join('; ')}`;
    return reply(res, 400, { error: 'Invalid payload', problems });
  }

  // Dedup before schema checks: a retry of something we already accepted must
  // get the original answer even if the schema has been re-published since.
  let result;
  const existing = byIdempotencyKey.get(key);
  if (existing) {
    result = { status: 200, json: { submissionId: existing.submissionId, duplicate: true } };
    res.locals.note = `${tag} duplicate of ${existing.submissionId}, not stored again`;
  } else {
    let schema;
    try {
      schema = loadSchemaFor(body.formId);
    } catch (err) {
      res.locals.note = `${tag} cannot load schema: ${err.message}`;
      return reply(res, 500, { error: 'Server could not load form schema' });
    }

    // A payload built against another form version is accepted, and flagged
    // through versionMismatch below — never rejected for it.
    const prepared = prepareSubmission(schema, body);
    if (!prepared.ok) {
      const { errors } = prepared;
      res.locals.note = `${tag} ${errors.length} validation error(s): ${errors.map((e) => `${e.blockId}: ${e.message}`).join('; ')}`;
      return reply(res, 422, { error: 'Validation failed', errors });
    }

    // Only the answers prepareSubmission returns are stored: anything for a
    // hidden or unknown question has already been stripped.
    const stripped = Object.keys(body.answers).filter((id) => !(id in prepared.answers));
    const record = {
      submissionId: randomUUID(),
      receivedAt: new Date().toISOString(),
      ...body,
      answers: prepared.answers,
    };
    submissions.push(record);
    byIdempotencyKey.set(key, record);
    persist();
    result = { status: 201, json: { submissionId: record.submissionId, duplicate: false } };
    const mismatchWarning = prepared.versionMismatch
      ? `WARNING version mismatch: built against ${body.formId}/${body.formVersionId}, schema is ${schema.formId}/${schema.formVersionId}`
      : null;
    res.locals.note =
      `${tag} stored as ${record.submissionId}; versionMismatch=${prepared.versionMismatch}` +
      (stripped.length > 0 ? `; stripped ${stripped.length} answer(s): ${stripped.join(', ')}` : '') +
      (mismatchWarning ? `; ${mismatchWarning}` : '');
    if (mismatchWarning) console.warn(`  ${tag} ${mismatchWarning}`);
  }

  if (processThenFailNext) {
    res.locals.note += ' [fault] process-then-fail: returning 500 anyway';
    return reply(res, 500, { error: 'Simulated failure after processing (process-then-fail-next).' });
  }
  return reply(res, result.status, result.json);
});

// ---- drafts: a stand-in for a host's own backend (drafts contract section 3)

// Device mode: the user's AES-GCM 256 key, derived from the server secret and
// the user id. A real host would take the user from its session, not a query.
app.get('/api/draft-key', (req, res) => {
  const user = String(req.query.user ?? '');
  if (!isNonEmptyString(user)) return res.status(400).json({ error: 'user is required' });
  const key = createHmac('sha256', DRAFT_KEY_SECRET).update(`draft-key:${user}`).digest('base64');
  res.locals.note = `key for user=${user}`;
  res.json({ key });
});

app.get('/api/drafts', (req, res) => {
  const { scope, formId } = req.query;
  if (!isNonEmptyString(scope) || !isNonEmptyString(formId)) return res.status(400).json({ error: 'scope and formId are required' });
  const found = drafts[draftId(scope, formId)];
  res.locals.note = found ? `draft found for ${formId} (saved ${found.draft.savedAt})` : `no draft for ${formId}`;
  res.json({ draft: found ? found.draft : null });
});

app.put('/api/drafts', (req, res) => {
  const { scope, draft } = req.body ?? {};
  if (!isNonEmptyString(scope) || !isPlainObject(draft) || !isNonEmptyString(draft.formId)) {
    return res.status(400).json({ error: 'scope and draft (with formId) are required' });
  }
  if (faults.failNextDraftSave) {
    faults.failNextDraftSave = false;
    res.locals.note = `[fault] fail-next-draft-save: draft for ${draft.formId} not stored`;
    return res.status(500).json({ error: 'Simulated draft save failure' });
  }
  drafts[draftId(scope, draft.formId)] = { scope, formId: draft.formId, storedAt: new Date().toISOString(), draft };
  persistDrafts();
  res.locals.note = `draft stored for ${draft.formId} on ${draft.onReview ? 'review' : draft.currentPageId ?? '-'}`;
  res.status(204).end();
});

app.delete('/api/drafts', (req, res) => {
  const { scope, formId } = req.query;
  if (!isNonEmptyString(scope) || !isNonEmptyString(formId)) return res.status(400).json({ error: 'scope and formId are required' });
  const id = draftId(scope, formId);
  const existed = id in drafts;
  delete drafts[id];
  persistDrafts();
  res.locals.note = `draft for ${formId} deleted (existed=${existed})`;
  res.status(204).end();
});

app.post('/api/_fail-next-draft-save', (req, res) => {
  faults.failNextDraftSave = true;
  res.locals.note = '[fault] armed: next draft save -> 500';
  res.json({ armed: 'fail-next-draft-save' });
});

app.get('/api/submissions', (req, res) => {
  res.locals.note = `${submissions.length} stored`;
  res.json(submissions);
});

app.post('/api/_fail-next', (req, res) => {
  faults.failNext = true;
  res.locals.note = '[fault] armed: next submit -> 500, not stored';
  res.json({ armed: 'fail-next' });
});

app.post('/api/_process-then-fail-next', (req, res) => {
  faults.processThenFailNext = true;
  res.locals.note = '[fault] armed: next submit -> processed, then 500';
  res.json({ armed: 'process-then-fail-next' });
});

app.post('/api/_delay-next', (req, res) => {
  const ms = Number(req.query.ms ?? 40000);
  if (!Number.isFinite(ms) || ms < 0) {
    return res.status(400).json({ error: 'ms must be a non-negative number' });
  }
  faults.delayNextMs = ms;
  res.locals.note = `[fault] armed: next submit delayed ${ms}ms`;
  res.json({ armed: 'delay-next', ms });
});

// Malformed JSON bodies land here instead of Express's HTML error page.
app.use((err, req, res, _next) => {
  const status = err.status ?? err.statusCode ?? 500;
  res.locals.note = `error: ${err.message}`;
  res.status(status).json({ error: status === 400 ? 'Malformed JSON body' : 'Internal server error' });
});

// Express 5 hands listen errors (e.g. EADDRINUSE) to this callback instead of
// throwing, so check it - otherwise a second copy would claim to be listening.
app.listen(PORT, (err) => {
  if (err) {
    console.error(
      err.code === 'EADDRINUSE'
        ? `Port ${PORT} is already in use - is another copy of this server still running? Stop it, or set PORT.`
        : `Server failed to start: ${err.message}`,
    );
    process.exit(1);
  }
  const schema = loadSchema();
  console.log(`Forms test API listening on http://localhost:${PORT}`);
  console.log(`  schema: ${SCHEMA_PATH} (formId=${schema.formId}, formVersionId=${schema.formVersionId})`);
  console.log(`  store:  ${STORE_PATH} (${submissions.length} submission(s) loaded)`);
  console.log(`  log:    ${REQUEST_LOG_PATH} (every request, JSON Lines)`);
  console.log(`  drafts: ${DRAFTS_PATH} (${Object.keys(drafts).length} server draft(s) loaded)`);
});

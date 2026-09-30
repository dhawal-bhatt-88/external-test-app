// Demo-mode stand-in for server/index.mjs, for the static GitHub Pages build.
// Same routes, request checks, response shapes and status codes, but all data
// lives in this browser's localStorage. Not secure: the draft-key secret ships
// in the bundle, so anyone can derive any user's key.
import { http, HttpResponse } from 'msw';
import { assertSchemaIntegrity, prepareSubmission } from '@yourco/forms/core';
import type { Draft, FormSchema, Submission } from '@yourco/forms/core';
import { apiUrl } from '../api';

// ---------------------------------------------------------------- schema

// The server's default FORM_SCHEMA, then every fixture in src/forms, so a
// submission validates against the schema with its formId (loadSchemaFor).
const CONFIGURED_SCHEMA = '../forms/phase7-pages-schema.json';
const SCHEMAS = import.meta.glob<FormSchema>('../forms/*.json', { eager: true, import: 'default' });

function loadSchemaFor(formId: string | undefined): FormSchema {
  const configured = SCHEMAS[CONFIGURED_SCHEMA];
  assertSchemaIntegrity(configured);
  if (!formId || configured.formId === formId) return configured;
  const schema = Object.values(SCHEMAS).find((s) => s.formId === formId);
  if (schema) {
    assertSchemaIntegrity(schema);
    return schema;
  }
  return configured;
}

// ---------------------------------------------------------------- storage

// Prefixed: every github.io project of this account shares one origin, and so
// one localStorage.
const STORAGE_PREFIX = 'external-test-app:demo:';

function read<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + name);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}
function write(name: string, value: unknown) {
  localStorage.setItem(STORAGE_PREFIX + name, JSON.stringify(value));
}

type StoredSubmission = Submission & { submissionId: string; receivedAt: string };
type StoredDraft = { scope: string; formId: string; storedAt: string; draft: Draft };

const loadSubmissions = () => read<StoredSubmission[]>('submissions', []);
const loadDrafts = () => read<Record<string, StoredDraft>>('drafts', {});
const draftId = (scope: string, formId: string) => JSON.stringify([scope, formId]);

// ---------------------------------------------------------------- failure simulation

// In localStorage rather than memory so, as with the server, a switch armed in
// one tab survives a reload and is seen by other tabs.
type Faults = { failNext: boolean; processThenFailNext: boolean; delayNextMs: number; failNextDraftSave: boolean };
const NO_FAULTS: Faults = { failNext: false, processThenFailNext: false, delayNextMs: 0, failNextDraftSave: false };
const loadFaults = () => ({ ...NO_FAULTS, ...read<Partial<Faults>>('faults', {}) });
function armFault(change: Partial<Faults>) {
  write('faults', { ...loadFaults(), ...change });
}

// ---------------------------------------------------------------- payload checks

const isPlainObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

function isBlockValue(v: unknown) {
  return isPlainObject(v) && (v.state === 'empty' || (v.state === 'answered' && 'value' in v));
}

/** Returns a list of problems with the top-level payload shape; empty if OK. */
function checkShape(body: unknown): string[] {
  if (!isPlainObject(body)) return ['body must be a JSON object'];
  const problems: string[] = [];
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

// ---------------------------------------------------------------- helpers

const MALFORMED = Symbol('malformed');
/** The parsed JSON body, undefined when empty, or MALFORMED (the server's 400). */
async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return MALFORMED;
  }
}
const malformed = () => HttpResponse.json({ error: 'Malformed JSON body' }, { status: 400 });
const noContent = () => new HttpResponse(null, { status: 204 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Device-mode keys: PBKDF2 over a fixed demo secret, salted with the user, so a
// user's key is the same on every visit and different from every other user's.
const DRAFT_KEY_SECRET = 'external-test-app-demo-draft-key-secret-not-secure';
async function deriveDraftKey(user: string): Promise<string> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(DRAFT_KEY_SECRET), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(`draft-key:${user}`), iterations: 100_000 },
    material,
    256,
  );
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

// ---------------------------------------------------------------- routes

export const handlers = [
  http.post(apiUrl('submit'), async ({ request }) => {
    const body = await jsonBody(request);
    if (body === MALFORMED) return malformed();

    // Fault flags are consumed by the next submit, whatever its outcome.
    const { failNext, processThenFailNext, delayNextMs } = loadFaults();
    armFault({ failNext: false, processThenFailNext: false, delayNextMs: 0 });

    if (delayNextMs > 0) await sleep(delayNextMs);
    if (failNext) return HttpResponse.json({ error: 'Simulated failure (fail-next); nothing was stored.' }, { status: 500 });

    const problems = checkShape(body);
    if (problems.length > 0) return HttpResponse.json({ error: 'Invalid payload', problems }, { status: 400 });
    const submission = body as Submission;

    // Dedup before schema checks, as the server does.
    let result: Response;
    const submissions = loadSubmissions();
    const existing = submissions.find((s) => s.idempotencyKey === submission.idempotencyKey);
    if (existing) {
      result = HttpResponse.json({ submissionId: existing.submissionId, duplicate: true }, { status: 200 });
    } else {
      let schema: FormSchema;
      try {
        schema = loadSchemaFor(submission.formId);
      } catch {
        return HttpResponse.json({ error: 'Server could not load form schema' }, { status: 500 });
      }

      const prepared = prepareSubmission(schema, submission);
      if (!prepared.ok) return HttpResponse.json({ error: 'Validation failed', errors: prepared.errors }, { status: 422 });

      // Only the answers prepareSubmission returns are stored.
      const record: StoredSubmission = {
        submissionId: crypto.randomUUID(),
        receivedAt: new Date().toISOString(),
        ...submission,
        answers: prepared.answers,
      };
      write('submissions', [...submissions, record]);
      if (prepared.versionMismatch) {
        console.warn(
          `[demo api] version mismatch: built against ${submission.formId}/${submission.formVersionId}, schema is ${schema.formId}/${schema.formVersionId}`,
        );
      }
      result = HttpResponse.json({ submissionId: record.submissionId, duplicate: false }, { status: 201 });
    }

    if (processThenFailNext) {
      return HttpResponse.json({ error: 'Simulated failure after processing (process-then-fail-next).' }, { status: 500 });
    }
    return result;
  }),

  // ---- drafts

  http.get(apiUrl('draft-key'), async ({ request }) => {
    const user = new URL(request.url).searchParams.get('user') ?? '';
    if (!isNonEmptyString(user)) return HttpResponse.json({ error: 'user is required' }, { status: 400 });
    return HttpResponse.json({ key: await deriveDraftKey(user) });
  }),

  http.get(apiUrl('drafts'), ({ request }) => {
    const query = new URL(request.url).searchParams;
    const scope = query.get('scope');
    const formId = query.get('formId');
    if (!isNonEmptyString(scope) || !isNonEmptyString(formId)) {
      return HttpResponse.json({ error: 'scope and formId are required' }, { status: 400 });
    }
    const found = loadDrafts()[draftId(scope, formId)];
    return HttpResponse.json({ draft: found ? found.draft : null });
  }),

  http.put(apiUrl('drafts'), async ({ request }) => {
    const body = await jsonBody(request);
    if (body === MALFORMED) return malformed();
    const { scope, draft } = isPlainObject(body) ? body : {};
    if (!isNonEmptyString(scope) || !isPlainObject(draft) || !isNonEmptyString(draft.formId)) {
      return HttpResponse.json({ error: 'scope and draft (with formId) are required' }, { status: 400 });
    }
    if (loadFaults().failNextDraftSave) {
      armFault({ failNextDraftSave: false });
      return HttpResponse.json({ error: 'Simulated draft save failure' }, { status: 500 });
    }
    const drafts = loadDrafts();
    drafts[draftId(scope, draft.formId)] = { scope, formId: draft.formId, storedAt: new Date().toISOString(), draft: draft as unknown as Draft };
    write('drafts', drafts);
    return noContent();
  }),

  http.delete(apiUrl('drafts'), ({ request }) => {
    const query = new URL(request.url).searchParams;
    const scope = query.get('scope');
    const formId = query.get('formId');
    if (!isNonEmptyString(scope) || !isNonEmptyString(formId)) {
      return HttpResponse.json({ error: 'scope and formId are required' }, { status: 400 });
    }
    const drafts = loadDrafts();
    delete drafts[draftId(scope, formId)];
    write('drafts', drafts);
    return noContent();
  }),

  http.post(apiUrl('_fail-next-draft-save'), () => {
    armFault({ failNextDraftSave: true });
    return HttpResponse.json({ armed: 'fail-next-draft-save' });
  }),

  // ---- submissions and submit faults

  http.get(apiUrl('submissions'), () => HttpResponse.json(loadSubmissions())),

  http.post(apiUrl('_fail-next'), () => {
    armFault({ failNext: true });
    return HttpResponse.json({ armed: 'fail-next' });
  }),

  http.post(apiUrl('_process-then-fail-next'), () => {
    armFault({ processThenFailNext: true });
    return HttpResponse.json({ armed: 'process-then-fail-next' });
  }),

  http.post(apiUrl('_delay-next'), ({ request }) => {
    const ms = Number(new URL(request.url).searchParams.get('ms') ?? 40000);
    if (!Number.isFinite(ms) || ms < 0) return HttpResponse.json({ error: 'ms must be a non-negative number' }, { status: 400 });
    armFault({ delayNextMs: ms });
    return HttpResponse.json({ armed: 'delay-next', ms });
  }),
];

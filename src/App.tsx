import { useEffect, useState } from 'react'
import './App.css'
import { FormRenderer, clearDrafts } from '@yourco/forms/react';
import type { Draft, DraftProblem, DraftRef, FormSchema } from '@yourco/forms/core';
//import deviceIntake from './forms/drafts-device-intake-schema.json';
//import deviceConsent from './forms/drafts-device-consent-schema.json';
//import serverIntake from './forms/drafts-server-intake-schema.json';
//import serverConsent from './forms/drafts-server-consent-schema.json';
//import builderExport from './forms/untitled-form-o5ndj-schema.json';
//import builderDevice from './forms/builder-drafts-device-schema.json';
//import builderServer from './forms/builder-drafts-server-schema.json';
import myForm from './forms/untitled-form-o5ndj-schema.json';
import longAnswers from './forms/long-answers-schema.json';
import displayBlocks from './forms/display-blocks-schema.json';
import builderDisplay from './forms/builder-display-blocks-schema.json';
import { apiUrl, isDemo } from './api';

// ---------------------------------------------------------------- the "host"
// A stand-in for a real host app: who is signed in, which patient is open,
// and which form. Everything lives in the query string, and changing it
// reloads the page — as switching accounts or patients would.

const FORMS = {
  //'device-intake': { label: 'Health intake — device drafts', schema: deviceIntake },
  //'device-consent': { label: 'Contact preferences — device drafts', schema: deviceConsent },
  //'server-intake': { label: 'Health intake — server drafts', schema: serverIntake },
  //'server-consent': { label: 'Contact preferences — server drafts', schema: serverConsent },
  //builder: { label: 'Builder export (session)', schema: builderExport },
  //'builder-device': { label: 'Builder export — device drafts', schema: builderDevice },
  //'builder-server': { label: 'Builder export — server drafts', schema: builderServer },
  'my-form': { label: 'User made form', schema: myForm },
  'long-answers': { label: 'Long answers (0.13.0)', schema: longAnswers },
  'display-blocks': { label: 'Text and image (0.14.0)', schema: displayBlocks },
  'builder-display': { label: 'Builder export: text and image', schema: builderDisplay },
} as const;
type FormKey = keyof typeof FORMS;

const USERS = ['alice', 'bob'];
const PATIENTS = [
  { id: 'p-100', name: 'J. Smith' },
  { id: 'p-200', name: 'M. Jones' },
];

const params = new URLSearchParams(location.search);
const user = params.get('user') ?? USERS[0];
const patient = PATIENTS.find((p) => p.id === params.get('patient')) ?? PATIENTS[0];
const requestedForm = params.get('form');
const formKey: FormKey = requestedForm !== null && requestedForm in FORMS ? (requestedForm as FormKey) : 'my-form';
// Test only: fetch another user's key while keeping this user's scope, to show
// that a draft encrypted under one key can't be opened with another.
const keyAs = params.get('keyAs');

const scope = `${user}:${patient.id}`;

function navigate(changes: Record<string, string | null>) {
  const next = new URLSearchParams(location.search);
  for (const [name, value] of Object.entries(changes)) {
    if (value === null) next.delete(name);
    else next.set(name, value);
  }
  location.search = next.toString();
}

// ---------------------------------------------------------------- device mode: the user's key

const keys = new Map<string, Promise<CryptoKey>>();
/** The user's AES-GCM 256 key from the host's server, imported non-extractable. */
function keyFor(keyUser: string): Promise<CryptoKey> {
  const cached = keys.get(keyUser);
  if (cached) return cached;
  const key = (async () => {
    const response = await fetch(`${apiUrl('draft-key')}?user=${encodeURIComponent(keyUser)}`);
    if (!response.ok) throw new Error(`draft-key: HTTP ${response.status}`);
    const { key: base64 } = (await response.json()) as { key: string };
    const raw = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  })();
  keys.set(keyUser, key);
  // A failed fetch isn't cached, so the next call tries again. Only this
  // promise's entry is removed, never a newer one for the same user.
  key.catch(() => {
    if (keys.get(keyUser) === key) keys.delete(keyUser);
  });
  return key;
}

// ---------------------------------------------------------------- server mode: the host's backend

async function loadDraft({ scope, formId }: DraftRef): Promise<Draft | null> {
  const response = await fetch(`${apiUrl('drafts')}?scope=${encodeURIComponent(scope)}&formId=${encodeURIComponent(formId)}`);
  if (!response.ok) throw new Error(`loadDraft: HTTP ${response.status}`);
  return ((await response.json()) as { draft: Draft | null }).draft;
}
async function saveDraft(draft: Draft): Promise<void> {
  const response = await fetch(apiUrl('drafts'), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, draft }),
  });
  if (!response.ok) throw new Error(`saveDraft: HTTP ${response.status}`);
}
async function deleteDraft({ scope, formId }: DraftRef): Promise<void> {
  const response = await fetch(`${apiUrl('drafts')}?scope=${encodeURIComponent(scope)}&formId=${encodeURIComponent(formId)}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error(`deleteDraft: HTTP ${response.status}`);
}

// ---------------------------------------------------------------- demo mode: stored submissions

type StoredSubmission = { submissionId: string; receivedAt: string; formId: string; answers: Record<string, unknown> };

/** What the demo API has stored in this browser; reloaded after each submit. */
function SubmissionsPanel({ version }: { version: number }) {
  const [submissions, setSubmissions] = useState<StoredSubmission[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    fetch(apiUrl('submissions'))
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json() as Promise<StoredSubmission[]>;
      })
      .then((list) => {
        if (current) setSubmissions(list);
      })
      .catch((err: Error) => {
        if (current) setError(err.message);
      });
    return () => {
      current = false;
    };
  }, [version]);

  return (
    <section id="demo-submissions" className="demo-submissions" aria-labelledby="demo-submissions-title">
      <h2 id="demo-submissions-title">Submissions</h2>
      {error ? (
        <p>Could not load submissions: {error}</p>
      ) : submissions === null ? (
        <p>Loading…</p>
      ) : submissions.length === 0 ? (
        <p>None yet in this browser.</p>
      ) : (
        <ol reversed>
          {[...submissions].reverse().map((s) => (
            <li key={s.submissionId}>
              <details>
                <summary>
                  {new Date(s.receivedAt).toLocaleString()} · {s.formId} · {Object.keys(s.answers).length} answer(s) ·{' '}
                  <code>{s.submissionId}</code>
                </summary>
                <pre>{JSON.stringify(s, null, 2)}</pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

// ---------------------------------------------------------------- app

function App() {
  const [problems, setProblems] = useState<DraftProblem[]>([]);
  const [signedOut, setSignedOut] = useState(false);
  const [submissionsVersion, setSubmissionsVersion] = useState(0);

  async function logOut() {
    // Every draft this user saved on this device, whichever patient or form.
    // Server drafts are the host's own decision: kept here.
    await clearDrafts({ owner: user });
    setSignedOut(true);
  }

  return (
    <>
      {isDemo && (
        <p id="demo-banner" className="demo-banner" role="note">
          <strong>Demo mode</strong> — data stays in this browser; not secure, don't enter real information.
        </p>
      )}
      <header className="host-bar" aria-label="Test host">
        <label>
          User{' '}
          <select id="host-user" value={user} onChange={(e) => navigate({ user: e.target.value, keyAs: null })}>
            {USERS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
        </label>
        <label>
          Patient{' '}
          <select id="host-patient" value={patient.id} onChange={(e) => navigate({ patient: e.target.value })}>
            {PATIENTS.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.id})</option>)}
          </select>
        </label>
        <label>
          Form{' '}
          <select id="host-form" value={formKey} onChange={(e) => navigate({ form: e.target.value })}>
            {Object.entries(FORMS).map(([key, f]) => <option key={key} value={key}>{f.label}</option>)}
          </select>
        </label>
        <button id="host-logout" type="button" onClick={logOut} disabled={signedOut}>Log out</button>
        <span className="host-scope">scope: <code>{scope}</code>{keyAs ? <> · key of <code>{keyAs}</code></> : null}</span>
      </header>

      {signedOut ? (
        <p id="host-signed-out">
          Signed out; {user}'s drafts on this device are cleared.{' '}
          <button type="button" onClick={() => location.reload()}>Sign in again</button>
        </p>
      ) : (
        <FormRenderer
          schema={FORMS[formKey].schema as unknown as FormSchema}
          endpoint={apiUrl('submit')}
          // Image blocks' root-relative paths (/images/…) load from under the
          // site's base (vite.config's base, e.g. "/external-test-app/").
          assetBase={import.meta.env.BASE_URL}
          drafts={{
            scope,
            owner: user,
            label: patient.name,
            getKey: () => keyFor(keyAs ?? user),
            loadDraft,
            saveDraft,
            deleteDraft,
          }}
          onDraftProblem={(problem) => {
            console.warn('Draft problem', problem);
            setProblems((list) => [...list, problem]);
          }}
          onSuccess={(res) => {
            console.log('Submitted', res.status);
            setSubmissionsVersion((v) => v + 1);
          }}
          onError={(err) => console.error('Submit failed', err)}
        />
      )}

      {problems.length > 0 && (
        <ol id="draft-problems" className="host-problems" aria-label="Draft problems reported to the host">
          {problems.map((p, i) => (
            <li key={i}>
              {p.type} ({p.mode}){p.reason ? ` — ${p.reason}` : ''}
              {p.error ? ` — ${String((p.error as Error).message ?? p.error)}` : ''}
            </li>
          ))}
        </ol>
      )}

      {isDemo && <SubmissionsPanel version={submissionsVersion} />}
    </>
  )
}

export default App

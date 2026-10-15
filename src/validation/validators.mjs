// The host's own validators (@zoworkhq/forms contract section 16), by formId.
// ONE module, imported by the page (src/App.tsx, passed to FormRenderer) and
// by the API (server/index.mjs and the demo mock, passed to
// prepareSubmission), so the server enforces exactly what the browser shows.
// Leave it out of prepareSubmission and anyone can bypass these rules by
// posting to the API directly.
//
// Rules for everything here: pure, fast and synchronous; no window, document
// or network. They run on every render in a paged form, and in Node.
import { validateMrn } from './mrn.mjs';

/** formId of src/forms/validators-schema.json. */
export const VALIDATORS_DEMO_FORM_ID = 'validators-demo';

const demoValidators = [
  { field: 'mrn', validate: validateMrn },
  {
    // Test only: makes this validator throw, to show the form fails closed
    // ("This answer couldn't be checked.") and the console names the field.
    field: 'ward',
    validate: ({ value }) => {
      if (String(value).trim().toLowerCase() === 'throw') throw new Error('Ward lookup table is not loaded (test throw).');
      return null;
    },
  },
  {
    // Dates are "YYYY-MM-DD", so they compare as strings. Admission is only
    // in answers when it is answered and valid.
    field: 'discharged',
    validate: ({ value, answers }) =>
      typeof answers.admitted === 'string' && value <= answers.admitted
        ? 'The discharge date must be after the admission date.'
        : null,
  },
  {
    // Runs once per medication. answers holds this medication's own
    // questions and the questions outside the repeat, never another
    // medication's.
    field: 'stopped',
    validate: ({ value, answers }) => {
      if (typeof answers.started === 'string' && value < answers.started) {
        return "The stop date can't be before the start date.";
      }
      if (typeof answers.discharged === 'string' && value > answers.discharged) {
        return "The stop date can't be after the discharge date.";
      }
      return null;
    },
  },
];

const BY_FORM_ID = { [VALIDATORS_DEMO_FORM_ID]: demoValidators };

/** The validators for a form, or undefined when it has none. The same array every time. */
export function validatorsFor(formId) {
  return Object.prototype.hasOwnProperty.call(BY_FORM_ID, formId) ? BY_FORM_ID[formId] : undefined;
}

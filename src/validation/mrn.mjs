// The MRN check-digit rule: "MRN" then 8 digits, the last a Luhn check digit
// over the first 7. Its own module, imported by the shared validators module,
// so the page and the API run exactly this code.
//
// Plain JavaScript with no imports, no window and no network: it runs in the
// browser and in Node alike.

const MRN_PATTERN = /^MRN(\d{8})$/;

/** The Luhn check digit for a string of digits. */
function luhnCheckDigit(digits) {
  let sum = 0;
  // From the rightmost digit, double every other one, starting with that one.
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 0) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return (10 - (sum % 10)) % 10;
}

/** A FieldValidator's validate for the MRN question. */
export function validateMrn({ value }) {
  const text = String(value).trim().toUpperCase();
  const match = MRN_PATTERN.exec(text);
  if (!match) {
    return 'Enter the MRN as "MRN" followed by 8 digits, for example MRN12345674.';
  }
  const body = match[1].slice(0, 7);
  const check = Number(match[1][7]);
  if (luhnCheckDigit(body) !== check) {
    return "This MRN's check digit doesn't match. Check it against the patient's wristband.";
  }
  return null;
}

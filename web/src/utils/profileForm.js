// Pure helpers for the profile form and the resume suggestions beside it.
//
// Profile values from the API are not all strings: years_of_experience is an
// INTEGER column (a number, e.g. 3 for every demo account) and any field can be
// null. Form inputs and comparisons work on strings, so every value goes
// through toFormText first. Calling .trim() on the raw value is what crashed the
// Profile page for demo accounts.

export function toFormText(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

// Initial form state from the user profile; every field is a string.
export function initialProfileForm(user) {
  return {
    name:                  toFormText(user?.name),
    target_role:           toFormText(user?.target_role),
    target_location:       toFormText(user?.target_location),
    years_of_experience:   toFormText(user?.years_of_experience),
    cover_letter_template: toFormText(user?.cover_letter_template),
  };
}

// Fields the resume parser can provide evidence for, in display order.
export const SUGGESTION_FIELDS = [
  { key: 'name',                label: 'Display name'        },
  { key: 'target_role',         label: 'Target role'         },
  { key: 'years_of_experience', label: 'Years of experience' },
  { key: 'target_location',     label: 'Target location'     },
];

// One row per field the server returned a suggestion for:
//   action 'matches' | 'use' (field empty) | 'replace' (field has another value)
//   | null (nothing found in the resume)
// `fillable` is the rows that can fill an empty field.
export function buildSuggestionRows(suggestions, form) {
  if (!suggestions) return { rows: [], fillable: [] };

  const rows = SUGGESTION_FIELDS
    .filter(f => suggestions[f.key])
    .map(f => {
      const s         = suggestions[f.key];
      const current   = toFormText(form?.[f.key]).trim();
      const found     = s.value !== null && s.value !== undefined;
      const suggested = toFormText(s.value);
      const action    = !found ? null
        : current === suggested ? 'matches'
        : current === '' ? 'use'
        : 'replace';
      return { ...f, s, current, suggested, found, action };
    });

  return { rows, fillable: rows.filter(r => r.action === 'use') };
}

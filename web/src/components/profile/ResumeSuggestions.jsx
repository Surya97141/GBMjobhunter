import { buildSuggestionRows } from '../../utils/profileForm';
import styles from './ResumeSuggestions.module.css';

// Shows what the resume parser found for each profile field, with the evidence,
// or why nothing was found. Applying a suggestion only changes the form; the
// user still reviews it and presses "Save changes". Fields the user has already
// filled are never overwritten without an explicit "Replace".
export default function ResumeSuggestions({ suggestions, form, onApply }) {
  if (!suggestions) return null;

  // Form values may be numbers or null (years_of_experience); the helper
  // compares them as strings.
  const { rows, fillable } = buildSuggestionRows(suggestions, form);

  function fillEmpty() {
    const updates = {};
    for (const r of fillable) updates[r.key] = r.suggested;
    onApply(updates);
  }

  return (
    <section className={styles.panel} aria-labelledby="resume-suggestions-title">
      <div className={styles.head}>
        <div>
          <h3 id="resume-suggestions-title" className={styles.title}>Suggestions from your resume</h3>
          <p className={styles.hint}>
            Read from your uploaded resume. Nothing is saved until you press Save changes.
          </p>
        </div>
        <button
          type="button"
          className={styles.fillBtn}
          onClick={fillEmpty}
          disabled={fillable.length === 0}
        >
          {fillable.length === 0 ? 'No empty fields to fill' : `Fill ${fillable.length} empty field${fillable.length === 1 ? '' : 's'}`}
        </button>
      </div>

      <ul className={styles.list}>
        {rows.map(({ key, label, s, current, suggested, found, action }) => {
          return (
            <li key={key} className={styles.row}>
              <div className={styles.rowMain}>
                <span className={styles.field}>{label}</span>
                {found ? (
                  <>
                    <span className={styles.value}>{suggested}</span>
                    <span className={styles.evidence}>{s.evidence}</span>
                  </>
                ) : (
                  <>
                    <span className={styles.notFound}>Not found in your resume</span>
                    <span className={styles.evidence}>{s.reason}</span>
                  </>
                )}
              </div>
              {found && (
                action === 'matches' ? (
                  <span className={styles.matches}>Matches your profile</span>
                ) : action === 'use' ? (
                  <button type="button" className={styles.useBtn} onClick={() => onApply({ [key]: suggested })}>
                    Use
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.useBtn}
                    onClick={() => onApply({ [key]: suggested })}
                    aria-label={`Replace your ${label.toLowerCase()} "${current}" with "${suggested}"`}
                  >
                    Replace
                  </button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

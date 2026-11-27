import { useId } from 'react';
import { useAiSettings } from '../../context/AiSettingsContext';
import styles from './AiSettingsPanel.module.css';

// AI mode picker shown wherever an AI request can be made. It always states
// which provider is selected and what data a request sends to it.
//
// `dataSent` describes, in plain words, what the requests on this page send
// (e.g. "your resume skills, target role and the recommended skills").
// "Groq", "Groq or OpenAI", "Groq, OpenAI or Anthropic (Claude)"
function providerList(providers) {
  const labels = providers.map(p => p.label);
  return labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}` : (labels[0] ?? '');
}

export default function AiSettingsPanel({ dataSent }) {
  const ai = useAiSettings();
  const id = useId();

  const demoReason = ai.statusState === 'loading'
    ? 'Checking whether the shared demo key is available…'
    : ai.statusState === 'error'
      ? 'AI status could not be loaded from the server.'
      : 'The shared demo key is not configured on this server.';

  return (
    <section className={styles.panel} aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className={styles.title}>AI provider</h2>

      <fieldset className={styles.modes}>
        <legend className={styles.srOnly}>AI mode</legend>

        <label className={`${styles.mode} ${!ai.demoAvailable ? styles.modeDisabled : ''}`}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="demo"
            checked={ai.mode === 'demo'}
            disabled={!ai.demoAvailable}
            onChange={() => ai.setMode('demo')}
          />
          <span>
            <span className={styles.modeName}>Shared demo key</span>
            <span className={styles.modeHint}>
              {ai.demoAvailable
                ? `Uses ${ai.status.demo.label}, provided by this server. Limited to ${ai.status.demo.limits.perUserPerDay} requests per day.`
                : demoReason}
            </span>
          </span>
        </label>

        <label className={styles.mode}>
          <input
            type="radio"
            name={`${id}-mode`}
            value="byok"
            checked={ai.mode === 'byok'}
            onChange={() => ai.setMode('byok')}
          />
          <span>
            <span className={styles.modeName}>My own API key</span>
            <span className={styles.modeHint}>{providerList(ai.providers)}.</span>
          </span>
        </label>
      </fieldset>

      {ai.mode === 'byok' && (
        <div className={styles.byok}>
          {!ai.secureTransport && (
            <p className={styles.warning} role="alert">
              This app is not connected to its server over HTTPS, so your own key cannot be used here.
            </p>
          )}
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Provider</span>
              <select
                className={styles.input}
                value={ai.provider}
                onChange={e => ai.setProvider(e.target.value)}
              >
                {ai.providers.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
            <label className={`${styles.field} ${styles.keyField}`}>
              <span className={styles.fieldLabel}>API key</span>
              <input
                className={styles.input}
                type="password"
                value={ai.apiKey}
                onChange={e => ai.setApiKey(e.target.value)}
                placeholder="Paste your key"
                autoComplete="off"
                spellCheck={false}
                disabled={!ai.secureTransport}
              />
            </label>
            {ai.apiKey && (
              <button type="button" className={styles.forget} onClick={ai.clearKey}>Forget key</button>
            )}
          </div>
          <p className={styles.note}>
            Your key is kept only in this browser tab&apos;s memory. It is sent over HTTPS to the
            GBMjobhunter server with each AI request, used for that request and not saved or logged.
            Reloading the page or signing out clears it.
          </p>
        </div>
      )}

      <p className={styles.disclosure} role="status">
        {ai.aiPayload ? (
          <>
            <strong>Selected: {ai.selected.label}{ai.selected.model ? ` (${ai.selected.model})` : ''}.</strong>{' '}
            When you run an AI request, {dataSent} will be sent to {ai.selected.label}.
          </>
        ) : ai.mode === 'demo' ? (
          'AI is not available right now. Everything else on this page works without it.'
        ) : (
          'Enter an API key to use AI. Everything else on this page works without it.'
        )}
      </p>
    </section>
  );
}

import { useEffect, useState } from 'react';

import { DEFAULT_EXCLUSIONS, normalizeExclusions } from '../tab-manager/exclusions';
import { getState, updateState } from '../tab-manager/storage';
import './options.css';

type StatusState = 'idle' | 'saving' | 'saved' | 'error';

export function OptionsApp() {
  const [exclusionsText, setExclusionsText] = useState('');
  const [status, setStatus] = useState<StatusState>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const stored = await getState();
        if (cancelled) {
          return;
        }
        setExclusionsText(stored.exclusions.join('\n'));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load settings.');
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      const normalized = normalizeExclusions(exclusionsText.split('\n'));
      await updateState((state) => ({
        ...state,
        exclusions: normalized,
      }));
      setExclusionsText(normalized.join('\n'));
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to save settings.');
    }
  };

  const handleReset = async () => {
    setStatus('saving');
    setError(null);
    try {
      const normalized = normalizeExclusions(DEFAULT_EXCLUSIONS);
      await updateState((state) => ({
        ...state,
        exclusions: normalized,
      }));
      setExclusionsText(normalized.join('\n'));
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Failed to reset settings.');
    }
  };

  return (
    <div className="options">
      <header className="options__header">
        <span className="options__badge">Tab Manager</span>
        <h1 className="options__title">Exclusion Rules</h1>
        <p className="options__subtitle">
          Add one pattern per line. Prefixes like <code>chrome://</code> or domains like{' '}
          <code>example.com</code> are supported.
        </p>
      </header>

      <section className="options__panel">
        <label className="options__label" htmlFor="exclusions">
          Excluded URL prefixes / domains
        </label>
        <textarea
          id="exclusions"
          className="options__textarea"
          value={exclusionsText}
          onChange={(event) => setExclusionsText(event.target.value)}
          rows={10}
          spellCheck={false}
        />
        <div className="options__actions">
          <button className="primary-button" type="button" onClick={handleSave}>
            Save
          </button>
          <button className="ghost-button" type="button" onClick={handleReset}>
            Reset defaults
          </button>
          <span className="options__status" aria-live="polite">
            {status === 'saving' && 'Saving...'}
            {status === 'saved' && 'Saved.'}
            {status === 'error' && 'Error.'}
          </span>
        </div>
        {error ? <p className="options__error">{error}</p> : null}
      </section>
    </div>
  );
}

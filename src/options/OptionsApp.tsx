import { useEffect, useState } from 'react';

import { DEFAULT_EXCLUSIONS, normalizeExclusions } from '../tab-manager/exclusions';
import { getState, updateState } from '../tab-manager/storage';
import './options.css';

type StatusState = 'idle' | 'saving' | 'saved' | 'error';

export function OptionsApp() {
  const [exclusionsText, setExclusionsText] = useState('');
  const [restoreLoadingSuppressionEnabled, setRestoreLoadingSuppressionEnabled] = useState(true);
  const [removeRestoredTabsEnabled, setRemoveRestoredTabsEnabled] = useState(true);
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
        setRestoreLoadingSuppressionEnabled(stored.restoreLoadingSuppressionEnabled);
        setRemoveRestoredTabsEnabled(stored.removeRestoredTabsEnabled);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '設定の読み込みに失敗しました。');
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
        restoreLoadingSuppressionEnabled,
        removeRestoredTabsEnabled,
      }));
      setExclusionsText(normalized.join('\n'));
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : '設定の保存に失敗しました。');
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
        restoreLoadingSuppressionEnabled: true,
        removeRestoredTabsEnabled: true,
      }));
      setExclusionsText(normalized.join('\n'));
      setRestoreLoadingSuppressionEnabled(true);
      setRemoveRestoredTabsEnabled(true);
      setStatus('saved');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : '設定のリセットに失敗しました。');
    }
  };

  return (
    <div className="options">
      <header className="options__header">
        <span className="options__badge">タブマネージャー</span>
        <h1 className="options__title">除外ルール</h1>
        <p className="options__subtitle">
          1行に1パターンずつ追加してください。<code>chrome://</code> のようなプレフィックスや{' '}
          <code>example.com</code> のようなドメインに対応しています。
        </p>
      </header>

      <section className="options__panel">
        <label className="options__label" htmlFor="exclusions">
          除外するURLプレフィックス / ドメイン
        </label>
        <textarea
          id="exclusions"
          className="options__textarea"
          value={exclusionsText}
          onChange={(event) => setExclusionsText(event.target.value)}
          rows={10}
          spellCheck={false}
        />
        <div className="options__toggles">
          <label className="options__toggle">
            <input
              className="options__toggle-input"
              type="checkbox"
              checked={restoreLoadingSuppressionEnabled}
              onChange={(event) => setRestoreLoadingSuppressionEnabled(event.target.checked)}
            />
            <span className="options__toggle-label">タブ復元時の読み込みを抑制</span>
          </label>
          <label className="options__toggle">
            <input
              className="options__toggle-input"
              type="checkbox"
              checked={removeRestoredTabsEnabled}
              onChange={(event) => setRemoveRestoredTabsEnabled(event.target.checked)}
            />
            <span className="options__toggle-label">復元したタブを履歴から削除する</span>
          </label>
        </div>
        <div className="options__actions">
          <button className="primary-button" type="button" onClick={handleSave}>
            保存
          </button>
          <button className="ghost-button" type="button" onClick={handleReset}>
            初期設定に戻す
          </button>
          <span className="options__status" aria-live="polite">
            {status === 'saving' && '保存中...'}
            {status === 'saved' && '保存しました。'}
            {status === 'error' && 'エラーが発生しました。'}
          </span>
        </div>
        {error ? <p className="options__error">{error}</p> : null}
      </section>
    </div>
  );
}

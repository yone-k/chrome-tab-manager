import { useEffect, useRef, useState } from 'react';

import { Button } from '../components/Button';
import { DEFAULT_EXCLUSIONS, normalizeExclusions } from '../tab-manager/exclusions';
import {
  CARD_HEIGHT_DEFAULT,
  CARD_HEIGHT_MAX,
  CARD_HEIGHT_MIN,
  clampCardHeight,
  getState,
  updateState,
} from '../tab-manager/storage';
import type { ThemeMode } from '../tab-manager/types';
import {
  applyThemeToDocument,
  getSystemPrefersDark,
  resolveTheme,
  subscribeSystemThemeChange,
} from '../theme/theme';
import './options.css';

type StatusState = 'idle' | 'saving' | 'saved' | 'error';

export function OptionsApp() {
  const [exclusionsText, setExclusionsText] = useState('');
  const [restoreLoadingSuppressionEnabled, setRestoreLoadingSuppressionEnabled] = useState(true);
  const [removeRestoredTabsEnabled, setRemoveRestoredTabsEnabled] = useState(true);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  const [status, setStatus] = useState<StatusState>('idle');
  const [error, setError] = useState<string | null>(null);
  const lastManualHeightRef = useRef<number>(CARD_HEIGHT_DEFAULT);

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
        setThemeMode(stored.themeMode);
        setCardHeight(stored.cardHeight);
        if (typeof stored.cardHeight === 'number') {
          lastManualHeightRef.current = stored.cardHeight;
        }
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

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    if (themeMode === 'system') {
      applyThemeToDocument(resolveTheme(themeMode, getSystemPrefersDark()));
      unsubscribe = subscribeSystemThemeChange((prefersDark) => {
        applyThemeToDocument(resolveTheme('system', prefersDark));
      });
    } else {
      applyThemeToDocument(resolveTheme(themeMode, false));
    }
    return () => {
      unsubscribe?.();
    };
  }, [themeMode]);

  const handleSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      const normalized = normalizeExclusions(exclusionsText.split('\n'));
      const nextCardHeight = cardHeight === null ? null : clampCardHeight(cardHeight);
      await updateState((state) => ({
        ...state,
        exclusions: normalized,
        restoreLoadingSuppressionEnabled,
        removeRestoredTabsEnabled,
        themeMode,
        cardHeight: nextCardHeight ?? null,
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
        themeMode: 'system',
        cardHeight: null,
      }));
      setExclusionsText(normalized.join('\n'));
      setRestoreLoadingSuppressionEnabled(true);
      setRemoveRestoredTabsEnabled(true);
      setThemeMode('system');
      setCardHeight(null);
      lastManualHeightRef.current = CARD_HEIGHT_DEFAULT;
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
        <h1 className="options__title">タブマネージャー設定</h1>
        <p className="options__subtitle">復元設定と除外ルールを管理できます。</p>
      </header>

      <section
        className="options__section options__section--restore"
        aria-labelledby="restore-settings"
      >
        <h2 id="restore-settings" className="options__section-title">
          復元設定
        </h2>
        <p className="options__section-description">タブ復元時の動作を設定します。</p>
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
      </section>

      <section
        className="options__section options__section--theme"
        aria-labelledby="theme-settings"
      >
        <h2 id="theme-settings" className="options__section-title">
          表示設定
        </h2>
        <p className="options__section-description">テーマを選択します。</p>
        <fieldset className="options__radio-group">
          <legend className="options__label">テーマモード</legend>
          <label className="options__radio">
            <input
              className="options__radio-input"
              type="radio"
              name="theme-mode"
              value="system"
              checked={themeMode === 'system'}
              onChange={() => setThemeMode('system')}
            />
            <span className="options__radio-label">システム準拠</span>
          </label>
          <label className="options__radio">
            <input
              className="options__radio-input"
              type="radio"
              name="theme-mode"
              value="light"
              checked={themeMode === 'light'}
              onChange={() => setThemeMode('light')}
            />
            <span className="options__radio-label">ライト</span>
          </label>
          <label className="options__radio">
            <input
              className="options__radio-input"
              type="radio"
              name="theme-mode"
              value="dark"
              checked={themeMode === 'dark'}
              onChange={() => setThemeMode('dark')}
            />
            <span className="options__radio-label">ダーク</span>
          </label>
        </fieldset>
        <fieldset className="options__fieldset">
          <legend className="options__legend">カードの高さ</legend>
          <label className="options__label">
            <input
              type="checkbox"
              checked={cardHeight === null}
              onChange={() => {
                if (cardHeight === null) {
                  setCardHeight(lastManualHeightRef.current);
                } else {
                  lastManualHeightRef.current = cardHeight;
                  setCardHeight(null);
                }
              }}
            />
            自動（画面サイズに合わせる）
          </label>
          {cardHeight !== null ? (
            <div className="options__range-group">
              <input
                className="options__range-input"
                type="range"
                min={CARD_HEIGHT_MIN}
                max={CARD_HEIGHT_MAX}
                value={cardHeight}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setCardHeight(value);
                  lastManualHeightRef.current = value;
                }}
              />
              <span className="options__range-value">{cardHeight}px</span>
            </div>
          ) : null}
        </fieldset>
      </section>

      <section
        className="options__section options__section--exclusions"
        aria-labelledby="exclusion-rules"
      >
        <h2 id="exclusion-rules" className="options__section-title">
          除外ルール
        </h2>
        <p className="options__section-description">
          1行に1パターンずつ追加してください。<code>chrome://</code> のようなプレフィックスや{' '}
          <code>example.com</code> のようなドメインに対応しています。
        </p>
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
      </section>

      <div className="options__footer">
        <div className="options__actions">
          <Button variant="primary" onClick={handleSave}>
            保存
          </Button>
          <Button variant="ghost" onClick={handleReset}>
            初期設定に戻す
          </Button>
          <span className="options__status" aria-live="polite">
            {status === 'saving' && '保存中...'}
            {status === 'saved' && '保存しました。'}
            {status === 'error' && 'エラーが発生しました。'}
          </span>
        </div>
        {error ? <p className="options__error">{error}</p> : null}
      </div>
    </div>
  );
}

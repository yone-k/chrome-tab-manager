# リポジトリガイドライン

## プロジェクト構成 / モジュール構成

- ルート設定: `manifest.json`, `popup.html`, `vite.config.ts`, `tsconfig.json`, `eslint.config.js`
- ソースコードは `src/popup/`（React のポップアップ UI）
  - エントリ: `src/popup/main.tsx`
  - アプリシェル: `src/popup/App.tsx`
  - スタイル: `src/popup/popup.css`
  - ユーティリティ: `src/popup/title.ts`
- テスト: `src/popup/__tests__/`（Vitest）
- 静的アセット: `public/icons/`（拡張アイコン）
- ビルド出力: `dist/`

## ビルド / テスト / 開発コマンド

コマンドはすべて `pnpm` を使用すること。

- `pnpm dev`: ポップアップ UI の Vite dev サーバを起動
- `pnpm build`: 型チェック後に本番ビルド（`tsc && vite build`）
- `pnpm preview`: 本番ビルドのプレビュー
- `pnpm test`: Vitest でユニットテスト実行
- `pnpm lint`: ESLint 実行
- `pnpm format`: Prettier でフォーマット
- `pnpm typecheck`: TypeScript の型チェックのみ
- `pnpm check`: lint + format + typecheck
- 一連のタスク完了時は必ず `pnpm check` を実行し、結果を報告すること

## コーディングスタイル / 命名規則

- Prettier が唯一の正とする: シングルクォート、セミコロン、末尾カンマ、100文字幅
- インデントは Prettier のデフォルト（2スペース）
- React コンポーネントは PascalCase（例: `App.tsx`）、関数/変数は camelCase
- ポップアップ UI のロジックは `src/popup/` に集約し、フォルダ横断の結合を避ける

## 開発アプローチ（TDD）

- RED → GREEN → REFACTOR を厳守（失敗テスト → 最小実装 → リファクタ）
- 単一責務・小さな単位を維持し、テスト容易性のため依存を明示する
- 新規フォルダ追加時はテストをコロケーションする（既存テストは `src/popup/__tests__/`）
- PR 前に品質チェック（`pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`）を行う

## テストガイドライン

- テストフレームワーク: Vitest
- 置き場所: `src/popup/__tests__/`
- 命名: `*.test.ts`（例: `title.test.ts`）
- ロジック変更時は `pnpm test` を実行する

## コミット / PR ガイドライン

- Conventional Commits を使用（例: `feat: add grouping UI`, `fix: handle empty title`）
- PR には短い要約と関連 Issue リンクを含める
- UI 変更の場合はスクリーンショット推奨（必須ではない）

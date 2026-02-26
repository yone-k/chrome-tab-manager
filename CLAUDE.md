# リポジトリガイドライン

## プロジェクト構成 / モジュール構成

- ルート設定: `manifest.json`, `manager.html`, `options.html`, `vite.config.ts`, `tsconfig.json`, `eslint.config.ts`
- ソースコード
  - `src/background/`: Service Worker（アクションクリック / コンテキストメニュー処理）
    - エントリ: `src/background/main.ts`
  - `src/manager/`: 管理画面 UI（保存済みウィンドウの検索・復元・並び替え）
    - エントリ: `src/manager/main.tsx`
    - アプリ: `src/manager/ManagerApp.tsx`
    - スタイル: `src/manager/manager.css`
  - `src/options/`: オプション画面 UI（復元設定・除外ルール・テーマ）
    - エントリ: `src/options/main.tsx`
    - アプリ: `src/options/OptionsApp.tsx`
    - スタイル: `src/options/options.css`
  - `src/tab-manager/`: 状態管理・履歴・フィルタなどのドメインロジック
  - `src/components/`: 共通 UI コンポーネント
  - `src/theme/`: テーマ解決ロジック
- テスト: 各モジュール配下の `*.test.ts`（Vitest）
- 静的アセット: `public/icons/`（拡張アイコン）
- ビルド出力: `dist/`

## ビルド / テスト / 開発コマンド

コマンドはすべて `pnpm` を使用すること。

- `pnpm dev`: Vite dev サーバを起動（拡張機能の UI 開発）
- `pnpm build`: 型チェック後に本番ビルド（`tsc && vite build`）
- `pnpm preview`: 本番ビルドのプレビュー
- `pnpm test`: Vitest でユニットテスト実行
- `pnpm lint`: ESLint 実行
- `pnpm format`: Prettier でフォーマット
- `pnpm typecheck`: TypeScript の型チェックのみ
- `pnpm check`: lint + format + typecheck
- タスク完了条件として `pnpm test` と `pnpm check` がどちらも成功していることを必須とする
- `pnpm test` と `pnpm check` の成功後、最後に `pnpm build` を実行し、成功した時点でタスク完了とする

## コーディングスタイル / 命名規則

- Prettier が唯一の正とする: シングルクォート、セミコロン、末尾カンマ、100文字幅
- インデントは Prettier のデフォルト（2スペース）
- React コンポーネントは PascalCase（例: `ManagerApp.tsx`）、関数/変数は camelCase
- UI は `src/manager/` と `src/options/` に分離し、状態ロジックは `src/tab-manager/` に集約する

## 開発アプローチ（TDD）

- RED → GREEN → REFACTOR を厳守（失敗テスト → 最小実装 → リファクタ）
- 単一責務・小さな単位を維持し、テスト容易性のため依存を明示する
- 新規モジュール追加時はコロケーションした `*.test.ts` を追加する
- PR 前に品質チェック（`pnpm lint`, `pnpm format`, `pnpm typecheck`, `pnpm test`）を行う

## テストガイドライン

- テストフレームワーク: Vitest
- 置き場所: 対象ファイルと同一ディレクトリ（例: `src/manager/*.test.ts`）
- 命名: `*.test.ts`（例: `lockState.test.ts`）
- ロジック変更時は `pnpm test` を実行する

## コミット / PR ガイドライン

- Conventional Commits を使用（例: `feat: add grouping UI`, `fix: handle empty title`）
- PR には短い要約と関連 Issue リンクを含める
- UI 変更の場合はスクリーンショット推奨（必須ではない）

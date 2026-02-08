# Chrome Tab Manager

Chrome のタブを保存して閉じ、あとでまとめて復元できる拡張機能です。  
保存済みタブはセット（ウィンドウ単位）として管理し、検索・フィルタ・ロック・並び替えに対応しています。

## 主な機能

- ツールバーアイコンのクリックで、現在ウィンドウのタブを保存して閉じる
- 拡張機能メニュー（アクションメニュー）から次の操作を実行可能
  - タブマネージャーを開く
  - タブを保存して閉じる（現在ウィンドウ）
  - 今開いているタブを保存して閉じる（アクティブタブ）
  - 今開いているグループを保存して閉じる
- 保存済みウィンドウ（セット）の一覧表示
  - タイトル / URL 検索
  - セット単位・グループ単位フィルタ
- 復元操作
  - セット全体、グループ単位、タブ単位で復元
  - 新規ウィンドウの作成
- 管理機能
  - セット・グループ・タブのロック
  - セット / グループ / タブのドラッグ&ドロップ並び替え
  - セット名・グループ名の編集
  - タブ情報の再取得
- オプション画面
  - 復元時の読み込み抑制
  - 復元済みタブを履歴から削除
  - 除外ルール（URL プレフィックス / ドメイン）
  - テーマ（システム準拠 / ライト / ダーク）

## 画面

- 管理画面: `manager.html`
- オプション画面: `options.html`

## 導入方法

### 1. Release から ZIP を取得して使う

1. GitHub の [Releases](https://github.com/yone/chrome-tab-manager/releases) から `chrome-tab-manager-vx.y.z.zip` をダウンロード
2. ZIP を展開し、展開先の `chrome-tab-manager` ディレクトリを確認
3. Chrome で `chrome://extensions` を開く
4. 右上の「デベロッパーモード」を有効化
5. 「パッケージ化されていない拡張機能を読み込む」で、手順2の `chrome-tab-manager` ディレクトリを選択

### 2. リポジトリを Clone して build して使う

1. リポジトリを取得

```bash
git clone https://github.com/yone/chrome-tab-manager.git
cd chrome-tab-manager
```

2. 依存関係をインストール

```bash
pnpm install
```

3. ビルド

```bash
pnpm build
```

4. Chrome で読み込む（開発者モード）

- Chrome で `chrome://extensions` を開く
- 右上の「デベロッパーモード」を有効化
- Clone + build の場合は `dist` ディレクトリが生成されるので、それを選択

## 開発コマンド

- `pnpm dev`: Vite 開発サーバーを起動
- `pnpm build`: 型チェック後に本番ビルド（`tsc && vite build`）
- `pnpm preview`: 本番ビルドをプレビュー
- `pnpm test`: Vitest テスト実行
- `pnpm lint`: ESLint 実行
- `pnpm format`: Prettier 実行
- `pnpm typecheck`: TypeScript 型チェック
- `pnpm check`: `lint + format + typecheck`

## データ保存と権限

- 状態は `chrome.storage.local` に保存
- 主な権限: `storage`, `tabs`, `tabGroups`, `contextMenus`

## プロジェクト構成

```text
.
├─ src/background/   # Service Worker（アクション・コンテキストメニュー処理）
├─ src/manager/      # 管理画面（保存済みウィンドウの操作 UI）
├─ src/options/      # オプション画面
├─ src/tab-manager/  # 状態管理・履歴・除外ルールなどのドメインロジック
├─ src/components/   # 共通 UI コンポーネント
├─ src/theme/        # テーマ解決ロジック
├─ manager.html
├─ options.html
└─ manifest.json
```

## 品質チェック手順

変更時は以下の順で確認してください。

```bash
pnpm test
pnpm check
pnpm build
```

## ライセンス

[MIT](./LICENSE)

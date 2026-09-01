# RAG Sample

## 概要
このプロジェクトは、Gemini API を使って「ドキュメント検索 + 回答生成」を体験するサンプルです。

実行時には、以下の流れで処理を行います。

1. Inspection ファイルから回答の前提条件を選択する
2. コンテキスト用のドキュメントを読み込む
3. embedding モデルでドキュメントと質問をベクトル化する
4. 類似度検索で関連度の高いテキストを抽出する
5. 生成モデルにコンテキストを渡して最終回答を取得する

このサンプルでは、業務ルール用と小説用の入力データを用意しており、`resources/` 配下の各ファイルを切り替えて実行できます。

---

## 技術スタック
- TypeScript
- Node.js
- Gemini API (`@google/genai`)
- `dotenv` による環境変数管理
- `tsx` による TypeScript 実行
- `Biome` による整形・Lint
- `tsc` による型チェック

主な依存関係は `package.json` に定義されています。今回は Gemini の embedding モデルと generation モデルを組み合わせて、RAG に近い流れで回答を生成します。

---

## セットアップ手順
### 1. 依存関係のインストール
ルートディレクトリで次を実行します。

```bash
npm install
```

### 2. 環境変数の設定
`rag-sample/.env` を作成または編集し、Gemini API キーを設定します。

```env
LLM_MODEL_EMBEDDED=gemini-embedding-2
LLM_MODEL_GENERATED=gemini-2.5-flash
GEMINI_API_KEY=your_api_key_here
```

> `GEMINI_API_KEY` は必須です。
> 未設定の場合は実行時にエラーになります。
> 環境変数に設定している場合、そちらを優先して読み込みます。

### 3. 入力ファイルの確認
`resources/` 配下に以下のようなファイルがあることを確認してください。

- `work-rules.inspection.txt`
- `work-rules.context.txt`
- `work-rules.prompt.txt`
- `novel.inspection.txt`
- `novel.context.txt`
- `novel.prompt.txt`

各ファイルは、Inspection / Context / Prompt の構成で読み込まれます。

---

## 実行手順
### 1. 開発用スクリプトの実行
以下のコマンドで、事前に用意されたサンプルをそのまま実行できます。

```bash
npm run start:work-rules
```

または、小説データを使う場合:

```bash
npm run start:novel
```

### 2. 手動でファイルを指定して実行
`npm run start --` を使って、Inspection / Context / Prompt を明示的に指定できます。

```bash
npm run start -- resources/work-rules.inspection.txt resources/work-rules.context.txt resources/work-rules.prompt.txt
```

```bash
npm run start -- resources/novel.inspection.txt resources/novel.context.txt resources/novel.prompt.txt
```

### 3. 実行時の挙動
- プロンプトが複数ある場合は選択プロンプトを入力して選ぶ
- Inspection が複数ある場合は選択を行う
- 関連する文脈を embedding 類似度で抽出する
- LLM に「Inspection + 関連コンテキスト + 質問」を渡して回答を生成する

実行結果はコンソールに `【LLMの回答】:` という形式で表示されます。

---

## 補足コマンド
```bash
npm run build
npm run lint
npm run check
```

- `npm run build`: フォーマットと TypeScript コンパイル
- `npm run lint`: Biome による静的チェック
- `npm run check`: 整形 + lint をまとめて実行

---

## 注意事項
- `.env` に API キーが設定されていないと動作しません
- 実行前に `resources/` 配下のファイルが存在することを確認してください
- Gemini のモデル名は `.env` またはデフォルト設定で変更可能です

必要に応じて、他の文書やプロンプトを追加して、独自のLLM活用例を増やすこともできます。

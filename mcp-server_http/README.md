# MCP Server HTTP (Streamable) Example

Streamable HTTPを使ったMCPサーバーの実装例です。Todo APIと連携するツール、Stateless/Statefulの実装例、およびプロンプトとリソースを公開する実装例を含みます。

## 構成

- MCP Server: `http://localhost:3000/mcp`
- Sample Web API: `http://localhost:3001`
- MCP Inspector: MCP Serverに接続する動作確認用クライアント

## 必要な環境

- Node.js 22+
- npm 11+

## セットアップ

```bash
npm install
```

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run build` | TypeScriptを`dist`にビルド |
| `npm run server` | Todo操作ツールを公開するメインサーバーを起動 |
| `npm run server_stateless` | Statelessの最小例を起動 |
| `npm run server_stateful` | Statefulのセッション管理例を起動 |
| `npm run server_prompt` | プロンプト/リソース例を起動 |
| `npm run server_resource` | `server_prompt`と同じサーバーを起動 |
| `npm run sample-api` | Todo用Sample Web APIを起動 |
| `npm run client` | MCP Inspectorを起動し、`http://localhost:3000/mcp`に接続 |
| `npm run verify_stateful_counter` | Statefulサーバーのセッション分離を検証 |

各サーバー起動スクリプトは、実行時にビルドも行います。

## 起動例: Todoツール

1. 1つ目のターミナルでSample Web APIを起動します。

```bash
npm run sample-api
```

2. 2つ目のターミナルでMCPサーバーを起動します。

```bash
npm run server
```

3. 必要に応じて別のターミナルでMCP Inspectorを起動します。

```bash
npm run client
```

Inspectorは`localhost:3000/mcp`に接続します。ポートを変更した場合は、Inspectorの接続先も合わせてください。

## 実装例

### `src/index.ts`: MCPサーバーからAPIを呼び出す基本形

MCPサーバーがツール呼び出しを受け付け、`fetch`でSample Web APIへHTTPリクエストを送る基本形です。`src/sample-web-api.ts`を直接importして呼び出すのではなく、`npm run sample-api`で別途起動したWeb APIを呼び出します。そのため、利用時はSample Web APIとMCPサーバーの両方を起動してください。

公開するツールは次のとおりです。

- `health_check`: Web APIの状態を取得
- `get_todo`: IDでTodoを取得
- `get_todo_by_no`: 番号でTodoを検索
- `list_todo`: Todo一覧を取得
- `register_todo`: タイトルと登録元を指定してTodoを登録
- `done_todo`: 番号でTodoを特定して完了状態に更新

### `src/index.stateless.ts`: ステートレスMCPサーバー

ステートレスなMCPサーバーの実装例です。`get_todo`ツールを公開し、各POSTリクエストの処理後にトランスポートとサーバーを終了します。MCPセッションの状態は保持しません。

### `src/index.stateful.ts`: ステートフルMCPサーバー

ステートフルなMCPサーバーの実装例です。`get_todo`および`counter`ツールを公開します。初回の`initialize`で発行された`MCP-Session-Id`を使ってセッションごとの接続コンテキストとカウンターを保持します。セッション情報とカウンターはプロセス内のMapに保存されます。

検証はStatefulサーバーを起動した状態で、別のターミナルから実行します。

```bash
npm run verify_stateful_counter
```

検証スクリプトはセッションAで`1, 2`、セッションBで`1, 2, 3`となることを確認します。`localhost`で接続できない環境では、次のように接続先を指定できます。

```powershell
powershell -ExecutionPolicy Bypass -File ./tools/verify-stateful-counter.ps1 -Endpoint http://127.0.0.1:3000/mcp
```

### `src/index.prompt-and-resource.ts`: プロンプトとリソース

MCPのプロンプトとリソースを公開する実装例です。次の機能を利用できます。

- 静的リソース`memory://guides/testcase-prompt-playbook`: APIテストケース作成ガイド
- リソーステンプレート`orders://{orderId}/detail`: 受注IDを含むJSON形式の受注詳細
- プロンプト`code-review-prompt`: 仕様書パスと対象コードパスを受け取り、コードレビュー指示を生成
- プロンプト`inventory-check-workflow`: 受注番号を受け取り、受注取得と在庫確認の手順を生成
- ツール`get-order`および`check-attached-inventory`: 在庫確認ワークフローのサンプル用ツール

起動するには次を実行します。

```bash
npm run server_prompt
```

## Sample Web API

`src/sample-web-api.ts`が提供するエンドポイントです。Todoデータはメモリ上に保持され、プロセス再起動で初期化されます。

| メソッド | パス | 内容 |
| --- | --- | --- |
| `GET` | `/health` | ヘルスチェック |
| `GET` | `/todos` | Todo一覧 |
| `GET` | `/todos/:id` | IDでTodoを取得 |
| `POST` | `/todos` | Todoを登録。`title`と`source`を指定 |
| `POST` | `/todos/search` | `no`でTodoを検索 |
| `PUT` | `/todos/:id/done` | Todoを完了状態に更新 |

## HTTPリクエスト例

ツール一覧を取得:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

`get_todo`を呼び出す:

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "get_todo",
      "arguments": { "id": 1 }
    }
  }'
```

## 環境変数

| 変数 | 用途 | デフォルト |
| --- | --- | --- |
| `PORT` | MCP Serverの待受ポート | `3000` |
| `WEB_API_PORT` | Sample Web APIの待受ポート | `3001` |
| `WEB_API_BASE_URL` | MCP Serverから見たWeb APIのベースURL | `http://localhost:3001` |

## HTTPエンドポイントについて

- MCPリクエストの受け口は`POST /mcp`です。
- Todo操作サーバー、Statelessサーバー、プロンプト/リソースサーバーは`GET /mcp`および`DELETE /mcp`に`405 Method Not Allowed`を返します。
- Statefulサーバーは`POST /mcp`のみを実装しています。
- `health_check`ツールは現在`/todos/health`を呼び出しますが、Sample Web APIのヘルスチェックルートは`/health`です。そのため、現状のままではこのツールの呼び出しは成功しません。
- このディレクトリの`.npmrc`設定を前提にしています。

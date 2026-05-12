# MCP Server HTTP (Streamable) Example

このプロジェクトは、HTTP（Streamable HTTP）トランスポートを使用したMCPサーバーの実装例です。

とくに**ローカル完結でWebAPI接続を体験できること**を重視したサンプルです。

構成は次の通りです。

- MCP Inspector
- MCP Server: `http://localhost:3000/mcp`
- サンプルWebAPI Server: `http://localhost:3001`

サンプルWebAPI Serverは、MCP Serverと分離した独立サンプルとして提供しています。

## 必要な環境

- Node.js 22.x+
- npm 11.x+

## セットアップ

```bash
npm install
```

## 実行方法

### サーバーの起動

1. ターミナル1: サンプルWebAPI Serverを起動

```bash
npm run sample-api
```

2. ターミナル2: MCP Serverを起動

```bash
npm run server
```

サンプルWebAPI起動時の表示：

```
Sample Web API server listening on http://localhost:3001
Sample Web API endpoint: http://localhost:3001/todos/1
```

MCP Server起動時の表示：

```
MCP Hello World Server (Streamable HTTP) running
MCP Server listening on http://localhost:3000
MCP endpoint: http://localhost:3000/mcp
```

### クライアント（MCP Inspector）での接続

別のターミナルで以下を実行：

```bash
npm run client
```

MCP Inspectorが自動的にサーバーに接続し、ブラウザが開きます。

## ツール

### `hello`

名前を受け取って、ウェルカムメッセージを返すツール

**パラメーター：**
- `name` (string): メッセージに追加する名前

**戻り値：**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Hello, {name}!"
    }
  ],
  "structuredContent": {
    "message": "Hello, {name}!"
  }
}
```

### `output_log`

ログ出力をデモンストレーションするツール（stdout/stderrの違いを確認）

**戻り値：**
```json
{
  "content": [
    {
      "type": "text",
      "text": "output log tool"
    }
  ]
}
```

### `fetch_web_api`

サンプルWebAPI（ローカル）へ接続し、レスポンスを取得するツール

**パラメーター：**
- `path` (string): WebAPIのパス（例: `/todos/1`）

**動作：**
- `WEB_API_BASE_URL` と `path` を結合してGETリクエストを送信
- 取得結果を `structuredContent` で返却
- デフォルト接続先は `http://localhost:3001`

**呼び出し例（tools/call）：**
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "fetch_web_api",
    "arguments": {
      "path": "/todos/1"
    }
  }
}
```

## HTTP Streamable プロトコル

このサーバーはHTTP Streamableトランスポートで通信します：

- **エンドポイント**: `http://localhost:3000/mcp`
- **プロトコル**: Streamable HTTP（HTTP POSTベース）
- **用途の中心**: MCPツール経由でローカルWebAPIへ接続し、結果をLLM/クライアントへ返却

### HTTP クライアントからのアクセス例

#### 1. ツール一覧取得（POST リクエスト）

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

#### 2. ツール実行（POST リクエスト）

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 2,
    "method": "tools/call",
    "params": {
      "name": "hello",
      "arguments": { "name": "World" }
    }
  }'
```

#### 3. WebAPI接続ツール実行（POST リクエスト）

```bash
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 3,
    "method": "tools/call",
    "params": {
      "name": "fetch_web_api",
      "arguments": { "path": "/todos/1" }
    }
  }'
```

## ビルド

```bash
npm run build
```

TypeScriptは `dist/` ディレクトリにコンパイルされます。

## 環境変数

- `PORT`: MCP Serverのポート番号（デフォルト: 3000）
- `WEB_API_PORT`: サンプルWebAPI Serverのポート番号（デフォルト: 3001）
- `WEB_API_BASE_URL`: `fetch_web_api` の接続先ベースURL（デフォルト: `http://localhost:3001`）

```bash
PORT=8080 npm run server
```

```bash
WEB_API_PORT=4001 WEB_API_BASE_URL=http://localhost:4001 npm run server
```

## コード構成

- `src/index.ts`: MCP Server（3000）の実装
  - `McpServer` インスタンスの作成
  - ツール（`hello`, `output_log`, `fetch_web_api`）の登録
  - `StreamableHTTPServerTransport` を使用したMCP Server（3000）の起動
- `src/sample-web-api.ts`: サンプルWebAPI Server（3001）の実装
  - `GET /health`
  - `GET /todos/:id`

## 注意事項

- HTTP Streamableトランスポートは、MCP Inspectorなど標準クライアントで自動的に処理されます
- 手動でクライアントを実装する場合は、MCP仕様のJSON-RPCリクエスト/レスポンスをHTTPで扱う必要があります
- `.npmrc` はこのディレクトリの設定（`min-release-age`, `ignore-scripts` など）をそのまま踏襲しています

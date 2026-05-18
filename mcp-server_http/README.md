# MCP Server HTTP (Streamable) Example

このフォルダーは、Streamable HTTPを使ったMCPサーバー実装例です。
ローカルのサンプルWeb APIと接続して、MCPツール経由でTodo操作を行う構成になっています。

## 構成

- MCP Inspector
- MCP Server: http://localhost:3000/mcp
- Sample Web API Server: http://localhost:3001

## 必要な環境

- Node.js 22.x以上
- npm 11.x以上

## セットアップ

```bash
npm install
```

## 利用可能スクリプト

```bash
npm run build
npm run server
npm run server_stateless
npm run server_stateful
npm run sample-api
npm run client
```

## 起動手順

1. ターミナル1で Sample Web API を起動

```bash
npm run sample-api
```

2. ターミナル2で MCP Server を起動（通常は `server`）

```bash
npm run server
```

補足: 比較用に最小サンプルを起動する場合

```bash
# Stateless 最小例
npm run server_stateless

# Stateful 最小例
npm run server_stateful
```

3. 必要に応じて MCP Inspector を起動

```bash
npm run client
```

## 実装ファイル

- src/index.ts
  - メイン実装
  - 複数 Todo ツールを公開
- src/index.stateless.ts
  - Stateless 実装の最小例
- src/index.stateful.ts
  - Stateful 実装の最小例
- src/sample-web-api.ts
  - ローカルの Todo API
- src/transport.util.ts
  - `McpServer.connect()` の型不一致回避用ユーティリティ

## サーバー実装の使い分け

- `npm run server`
  - メイン実装（Todo操作ツール一式）
- `npm run server_stateless`
  - Stateless の最小実装例
- `npm run server_stateful`
  - Stateful の最小実装例

## src/index.ts で公開しているツール

- health_check
- get_todo
- get_todo_by_no
- list_todo
- register_todo
- done_todo

## Sample Web API エンドポイント

- GET /health
- GET /todos
- GET /todos/:id
- POST /todos
- POST /todos/search
- PUT /todos/:id/done

## HTTP リクエスト例

tools/list:

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

get_todo の呼び出し:

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

- PORT
  - MCP Server のポート
  - デフォルト: 3000
- WEB_API_PORT
  - Sample Web API のポート
  - デフォルト: 3001
- WEB_API_BASE_URL
  - MCP Server から見た接続先 Web API のベース URL
  - デフォルト: http://localhost:3001

## 補足

- GET /mcp と DELETE /mcp は 405 を返します
- MCP の受け口は POST /mcp です
- このディレクトリの .npmrc 設定を前提にしています

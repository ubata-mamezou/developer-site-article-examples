# mcp-server_stdio

MCP Serverのstdio実装サンプルです。

## 前提

- Node.js 22+
- npm

## セットアップ

```sh
npm install
```

## 実行方法

```sh
# TypeScript をビルド
npm run build

# サーバー起動
npm run server

# MCP Inspector で接続
npm run client
```

## 提供ツール

- `hello`: 名前を受け取り、`Hello, {name}!` を返す
- `output_log`: stdout/stderrへのログ出力を確認するための検証用ツール

## JSON-RPC 例

stdioで直接通信する場合の例です。以下は完全なMCPシーケンスですが、1・2の初期化ステップは実装によっては省略可能です。

1. `initialize`（任意）
```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"manual-client","version":"1.0.0"}}}
```

2. `notifications/initialized`（任意）
```json
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
```

3. `tools/list`
```json
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

4. `tools/call` (`hello`)
```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"hello","arguments":{"name":"MCP"}}}
```

5. `tools/call` (`output_log`)
```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"output_log","arguments":{}}}
```

## 注意事項

- stdio通信ではstdoutはJSON-RPCメッセージ専用です。
- `output_log` は意図的に `console.log` / `console.info` を使ってstdoutを汚し、パースエラーの再現を行うためのツールです。
- 実運用ではアプリログはstderrに出力してください。
- 初期化ステップ（1・2）を省略して3から直接開始することも可能です（実装依存）。

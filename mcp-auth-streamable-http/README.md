# MCP Auth Streamable HTTP Example

このフォルダーは、MCP Streamable HTTPサーバーにBearer認証を追加し、
Keycloakのトークンイントロスペクションで検証する最小構成のサンプルです。

`docker-compose.yml` とRealm初期データを同梱しているため、
Keycloakをすぐに起動してデモを実行できます。

- MCP endpoint: `http://localhost:3020/mcp`
- Protected Resource Metadata endpoint: `http://localhost:3020/.well-known/oauth-protected-resource`

本サンプルは MCP SDK v2 の `@modelcontextprotocol/express` が提供する `mcpAuthMetadataRouter` と `requireBearerAuth` を使い、
トークンの検証はKeycloakのイントロスペクションエンドポイントへ委譲します。

## 必要な環境

- Node.js 24.x以上
- npm 11.x以上

## セットアップ

```bash
npm install
```

## Keycloak起動（デモ用）

```bash
docker compose up -d
```

同梱Realmにより、以下が自動作成されます。

- realm: `mcp-demo`
- scope: `mcp:tools`
- introspection client: `mcp-server` / `mcp-server-secret`
- token取得用 client: `mcp-demo-client` / `mcp-demo-client-secret`

## 起動

```bash
npm run start
```

## 環境変数

- `PORT`: サーバーのポート（既定: `3020`）
- `MCP_PATH`: MCPエンドポイント（既定: `/mcp`）
- `RESOURCE_SERVER_URL`: PRMの`resource`値（既定: `http://localhost:3020/mcp`）
- `KEYCLOAK_ISSUER_URL`: Keycloak issuer URL（既定: `http://localhost:8080/realms/mcp-demo`）
- `KEYCLOAK_INTROSPECTION_ENDPOINT`: introspection endpoint
- `OAUTH_CLIENT_ID`: introspectionに使うclient_id
- `OAUTH_CLIENT_SECRET`: introspectionに使うclient_secret
- `REQUIRED_SCOPE`: 必須スコープ（既定: `mcp:tools`）
- `OAUTH_STRICT`: `true`の場合は`aud`検証を必須化

## 認証なしアクセスの確認

```bash
curl -i -X POST http://localhost:3020/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

`401 Unauthorized` と `WWW-Authenticate` ヘッダーが返ります。

## PRMの確認

```bash
curl -s http://localhost:3020/.well-known/oauth-protected-resource/mcp
```

## 認証ありで tools/list

まずKeycloakからアクセストークンを取得します。

```bash
curl -s -X POST http://localhost:8080/realms/mcp-demo/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=mcp-demo-client" \
  -d "client_secret=mcp-demo-client-secret"
```

レスポンスの`access_token`を使って、MCPへアクセスします。

```bash
curl -s -X POST http://localhost:3020/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <ACCESS_TOKEN_FROM_KEYCLOAK>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## 認証ありで tools/call

```bash
curl -s -X POST http://localhost:3020/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <ACCESS_TOKEN_FROM_KEYCLOAK>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"sum_numbers","arguments":{"a":4,"b":7}}}'
```

## 疎通確認スクリプト

以下を実行すると、Keycloakからトークン取得後に`tools/list`と`tools/call`まで自動確認します。

```bash
npm run verify:auth-flow
```

必要に応じて以下の環境変数で上書きできます。

- `MCP_ENDPOINT`
- `KEYCLOAK_TOKEN_ENDPOINT`
- `CLIENT_ID`
- `CLIENT_SECRET`

## 後片付け

```bash
docker compose down
```

## 実装ポイント

- `POST /mcp` の前段でBearerトークンを検証
- SDK標準の`mcpAuthMetadataRouter`でPRMを公開
- SDK標準の`requireBearerAuth`で401チャレンジを返却
- introspection結果の`aud`と`scope`を検証
- ツールは `sum_numbers` と `get_server_policy` を登録

## 後片付け

```bash
docker compose down
```

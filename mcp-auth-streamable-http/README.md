# MCP Auth Streamable HTTP Example

このフォルダーは、MCP Streamable HTTPサーバーにBearer認証を追加し、
Keycloakのトークンイントロスペクションで検証する最小構成のサンプルです。

`docker-compose.yml` とRealm初期データを同梱しているため、
Keycloakをすぐに起動してデモを実行できます。

- MCP endpoint: `http://localhost:3020/mcp`
- Protected Resource Metadata endpoint: `http://localhost:3020/.well-known/oauth-protected-resource`

本サンプルはMCP SDK v2の `@modelcontextprotocol/express` が提供する `mcpAuthMetadataRouter` と `requireBearerAuth` を使い、トークンの検証はKeycloakのイントロスペクションエンドポイントへ委譲します。

## 利用技術

- Node.js 24.x+
- npm 11.x+
- TypeScript 7
- @modelcontextprotocol 2+
- Keycloak 26.3.4
- Docker compose

## セットアップ

```sh
npm i
```

## 環境変数

設定値は`.env.sample`を参照してください。

## 起動手順

1. Keycloak起動（デモ用）

```sh
docker compose up -d
```

同梱Realmにより、以下のデモ値が自動作成されます。

- realm: `mcp-demo`
- scope: `mcp:tools`
- introspection client: `mcp-server` / `mcp-server-secret`
- token取得用client: `mcp-demo-client` / `mcp-demo-client-secret`

> [NOTE]
> これらの値はローカル検証用の固定デモ設定です。  
> 実際の運用環境では`client_secret`はSecret機能を利用してコード上にもってはいけません。

2. MCPサーバー起動

```sh
npm run start
```

## 終了手順

1. MCPサーバー停止

Ctrl+Cで終了する。

2. Keycloak停止
```sh
docker compose down
```

---
## 実行

まずはMCP Inspectorで試行。

### Authorizationヘッダーなし（MCP Inspector）

**UI上のメッセージ**
```txt
OAuth Authorization Failed
Policy 'Allowed Client Scopes' rejected request to client-registration service. Details: Not Permitted to use specified clientScope
```

**コンソールに出力されるログ**
```sh
Error from MCP server: StreamableHTTPError: Streamable HTTP error: Error POSTing to endpoint: {"error":"invalid_token","error_description":"Missing Authorization header"}
    at StreamableHTTPClientTransport.send (file:///xxx/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js:364:23)
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
  code: 401
}
```

### Authorizationヘッダーなし（curl）

MCP Inspectorだとエラー内容がよくわからないのでcurlで再検証

```sh
curl -i -X POST http://localhost:3020/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

HTTP/1.1 401 Unauthorized
X-Powered-By: Express
WWW-Authenticate: Bearer error="invalid_token", error_description="Missing Authorization header", scope="mcp:tools", resource_metadata="http://localhost:3020/.well-known/oauth-protected-resource/mcp"
Content-Type: application/json; charset=utf-8
Content-Length: 76
ETag: xxxxxxxxxx
Date: Mon, 03 Aug 2026 15:30:41 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":"invalid_token","error_description":"Missing Authorization header"}
```
エラーは期待通り、`401 Unauthorized`で「Authorizationヘッダーが見つからない」となった。

### Authorizationヘッダーに`Bearer `から始まらない値を設定

```sh
curl -i -X POST http://localhost:3020/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: bad_format_token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

HTTP/1.1 401 Unauthorized
X-Powered-By: Express
WWW-Authenticate: Bearer error="invalid_token", error_description="Invalid Authorization header format, expected 'Bearer TOKEN'", scope="mcp:tools", resource_metadata="http://localhost:3020/.well-known/oauth-protected-resource/mcp"
Content-Type: application/json; charset=utf-8
Content-Length: 108
ETag: xxxxxxxxxx
Date: Mon, 03 Aug 2026 15:48:43 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":"invalid_token","error_description":"Invalid Authorization header format, expected 'Bearer TOKEN'"}
```
エラーは期待通り、`401 Unauthorized`で「形式が有効ではない」となった。

### Authorizationヘッダーに、形式は正しいが存在しないtokenを指定

```sh
curl -i -X POST http://localhost:3020/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer unknown_token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

HTTP/1.1 401 Unauthorized
X-Powered-By: Express
WWW-Authenticate: Bearer error="invalid_token", error_description="Inactive token", scope="mcp:tools", resource_metadata="http://localhost:3020/.well-known/oauth-protected-resource/mcp"
Content-Type: application/json; charset=utf-8
Content-Length: 62
ETag: xxxxxxxxxx
Date: Mon, 03 Aug 2026 16:07:44 GMT
Connection: keep-alive
Keep-Alive: timeout=5

{"error":"invalid_token","error_description":"Inactive token"}
```
エラーは期待通り、`401 Unauthorized`で「tokenはアクティブではない」となった。

## PRM(Protected Resource Metadata)の確認

```sh
curl -s http://localhost:3020/.well-known/oauth-protected-resource/mcp

{"resource":"http://localhost:3020/mcp","authorization_servers":["http://localhost:8080/realms/mcp-demo"],"scopes_supported":["mcp:tools"],"resource_name":"MCP Auth Streamable HTTP"}
```

## 認証して、有効なトークンを使ってアクセス

まずKeycloakからアクセストークンを取得します。

**トークン取得**
```sh
curl -s -X POST http://localhost:8080/realms/mcp-demo/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=mcp-demo-client" \
  -d "client_secret=mcp-demo-client-secret"

{"access_token":"<valid_token>","expires_in":300,"refresh_expires_in":0,"token_type":"Bearer","not-before-policy":0,"scope":"mcp:tools"}
```

**MCPサーバーへアクセス**

レスポンスの`access_token`を使って、MCPへアクセスします。

```sh
curl -s -X POST http://localhost:3020/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <valid_token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'

event: message
data: {"result":{"tools":[{"name":"sum_numbers","title":"sum_numbers","description":"Sum two numbers","inputSchema":{"type":"object","$schema":"https://json-schema.org/draft/2020-12/schema","properties":{"a":{"type":"number","description":"first number"},"b":{"type":"number","description":"second number"}},"required":["a","b"]},"outputSchema":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"result":{"type":"number","description":"sum result"}},"required":["result"],"additionalProperties":false}},{"name":"get_server_policy","title":"get_server_policy","description":"Return simple authorization policy for demo","inputSchema":{"type":"object","properties":{}},"outputSchema":{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"object","properties":{"resource":{"type":"string","description":"resource server url"},"requiredScope":{"type":"string","description":"required scope"}},"required":["resource","requiredScope"],"additionalProperties":false}}]},"jsonrpc":"2.0","id":1}
```
無事アクセスできました。  
2026-07-28RCでも謳われていたようにInputSchema, OutputSchemaが2020-12JSONスキーマに準拠していることも見て取れます。


## 疎通確認スクリプト

以下を実行すると、Keycloakからトークン取得後に`tools/list`と`tools/call`まで自動確認します。

```sh
npm run verify:auth-flow
```

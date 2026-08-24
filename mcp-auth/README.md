# MCP Auth Streamable HTTP Example

このフォルダーは、MCP Streamable HTTPサーバーにBearer認証を追加し、
Keycloakのトークンイントロスペクションで検証する最小構成のサンプルです。

`docker-compose.yml` とRealm初期データを同梱しているため、Keycloakをすぐに起動してデモを実行できます。

- MCP endpoint: `http://localhost:3000/mcp`
- Protected Resource Metadata endpoint: `http://localhost:3000/.well-known/oauth-protected-resource/mcp`
- Keycloak endpoint: `http://localhost:8081`

本サンプルはMCP SDK v2の `@modelcontextprotocol/express` が提供する `mcpAuthMetadataRouter` と `requireBearerAuth` を使い、トークンの検証はKeycloakのイントロスペクションエンドポイントへ委譲します。

## 利用技術

- Node.js 26+
- npm 12+
- TypeScript 7
- @modelcontextprotocol 2+
- Keycloak 26.3.4
- Docker compose

## セットアップ

```sh
npm i
```

## 環境変数

設定値は`.env.example`を参照してください。Keycloakのホスト側ポートは`8081`、コンテナー内部のポートは`8080`です。

## 起動手順

1. Keycloak起動（デモ用）

```sh
docker compose up -d
```

同梱Realmにより、以下のデモ用設定が自動作成されます。

* realm: `mcp-demo`
* Client Scope:
  * `mcp:tools`: aud=`http://localhost:3000/mcp`
  * `mcp:no-scope`: aud=`http://localhost:3000/mcp`
  * `mcp:diff-audience`: aud=`http://localhost:3000/mcp-diff`
* Client
  * Introspection用: `mcp-server`, `mcp-server-secret`
  * 正常系トークン取得用: `mcp-demo-client`, `mcp-demo-client-secret`
  * Scope不足検証用: `mcp-demo-no-scope-client`, `mcp-demo-no-scope-client-secret`（`mcp:no-scope`を付与）
  * Audienceなし検証用: `mcp-demo-no-audience-client`, `mcp-demo-no-audience-client-secret`
  * Audience不一致検証用: `mcp-demo-diff-audience-client`, `mcp-demo-diff-audience-client-secret`（`mcp:diff-audience`を付与）

> [NOTE]
> これらの値はローカル検証用の固定デモ設定です。  
> 実際の運用環境では`client_secret`はSecret機能を利用してコード上にもってはいけません。

1. 環境変数の設定（必要な場合）

`.env.example`の値を使用する場合は、シェルに読み込んでからサーバーを起動します。

3. MCPサーバー起動

```sh
npm run server
```

## 手動実行

1. トークン取得
```sh
curl -s -X POST http://localhost:8081/realms/mcp-demo/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=mcp-demo-client" \
  -d "client_secret=mcp-demo-client-secret"

{"access_token":"<valid_token>","expires_in":300,"refresh_expires_in":0,"token_type":"Bearer","not-before-policy":0,"scope":"mcp:tools"}
```

レスポンスの`access_token`を使ってMCPサーバーへアクセスします。`-i`を付けると、レスポンスヘッダーとHTTPステータスも確認できます。

2. MCPサーバーへアクセス

レスポンスの`access_token`を使って、MCPへアクセスします。

```sh
curl -s -X POST http://localhost:3000/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <valid_token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## エラーケースの確認

### Scope不足

`mcp-demo-no-scope-client`には`mcp:tools`を割り当てていません。取得したトークンは有効ですが必要Scopeがないため、MCPサーバーは`403 Forbidden`を返します。

```sh
curl -i -s -X POST http://localhost:8081/realms/mcp-demo/protocol/openid-connect/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=mcp-demo-no-scope-client" \
  -d "client_secret=mcp-demo-no-scope-client-secret"

curl -i -s -X POST http://localhost:3000/mcp \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

期待する結果:

```text
HTTP/1.1 403 Forbidden
{"error":"insufficient_scope","error_description":"Insufficient scope"}
```

### Audienceなし・Audience不一致

`OAUTH_STRICT=true`の場合、トークンにはMCPサーバー向けのAudienceが必要です。Audienceがない場合、または`http://localhost:3000/mcp`と異なるAudienceの場合は`401 Unauthorized`になります。

```text
Audienceなし:
{"error":"invalid_token","error_description":"Resource indicator (aud) missing"}

Audience不一致:
{"error":"invalid_token","error_description":"Expected audience compatible with http://localhost:3000/mcp, got: http://localhost:3000/mcp-diff"}
```

これらのケースを実行するには、RealmにAudience Mapperを持つ検証用Client Scopeと、それを割り当てたClientを追加します。正常系の`mcp:tools`に正しいAudience Mapperを残したまま、誤ったAudienceを追加すると正しいAudienceもトークンに含まれて検証を通過するため、Audience MapperはScope単位で分離してください。

## 終了手順

1. MCPサーバー停止

Ctrl+Cで終了する。

2. Keycloak停止
```sh
docker compose down
```

## 疎通確認

以下を実行すると、Keycloakからトークンを取得し、`tools/list`と`tools/call`を自動確認します。これは`client_credentials`を使った検証であり、MCP仕様のAuthorization Code + PKCEフロー全体を実行するものではありません。

```sh
npm run verify:auth-flow
```

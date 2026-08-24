// MCP SDK v2 パッケージ群から必要なシンボルをインポート
// @modelcontextprotocol/server  … MCPサーバー本体・認証ユーティリティ
// @modelcontextprotocol/express … Express向けミドルウェア（PRM公開・Bearer認証）
// @modelcontextprotocol/node    … Node.js向けStreamable HTTPトランスポート
import { McpServer } from "@modelcontextprotocol/server";
import {
  createMcpExpressApp,
  getOAuthProtectedResourceMetadataUrl,
  mcpAuthMetadataRouter,
  requireBearerAuth,
} from "@modelcontextprotocol/express";
import { oauthMetadata, createTokenVerifier, REQUIRED_SCOPE } from "./providers/keycloak.js";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";

/** このサーバーがリッスンするポート番号。 */
const PORT = Number(process.env.PORT ?? "3000");
/** MCPエンドポイントのパス。 */
const MCP_PATH = process.env.MCP_PATH ?? "/mcp";
/** このサーバー自身の公開URL。Audience検証（`aud` クレーム）やPRMの `resource` フィールドに使用する。 */
const RESOURCE_SERVER_URL = process.env.RESOURCE_SERVER_URL ?? `http://localhost:${PORT}${MCP_PATH}`;

/**
 * MCP向けのExpressアプリインスタンス。
 * 
 * 通常の `express()` の代わりに使用する。
 * ホストヘッダー・オリジン検証などのMCP向けセキュリティ設定が内包されている。
 */
const app = createMcpExpressApp();

/**
 * このサーバーのURLをURL型で保持したもの。
 * 
 * `checkResourceAllowed` やPRM生成など複数箇所で再利用する。
 */
const mcpServerUrl = new URL(RESOURCE_SERVER_URL);

/**
 * OAuth Authorization Serverのメタデータ。
 * 
 * `GET /.well-known/oauth-protected-resource`（PRM）のレスポンスに含まれる。
 * MCPクライアントはこの情報を参照して「どこでトークンを取得すればよいか」を自動検出する。
 */
const tokenVerifier = createTokenVerifier(mcpServerUrl);

// GET /.well-known/oauth-protected-resource (PRM) を公開する。
// MCPクライアントが「このサーバーの認証情報はどこで取得できるか」を自動検出するために使う。
app.use(
  mcpAuthMetadataRouter({
    oauthMetadata,
    resourceServerUrl: mcpServerUrl,
    scopesSupported: [REQUIRED_SCOPE],
    resourceName: "MCP Auth Streamable HTTP",
  }),
);

/**
 * Bearer認証ミドルウェア。
 * 
 * ルートハンドラーの前段に置くことで、以下を一括で処理する。
 * 1. `Authorization` ヘッダーの存在確認
 * 2. `tokenVerifier.verifyAccessToken` 経由でKeycloakにintrospectionを実施
 * 3. 必要スコープの保有確認
 *
 * 認証失敗時はここで401/403を返し、後続のハンドラーには到達しない。
 * 401応答の `WWW-Authenticate` ヘッダーにPRM URLを含めることで
 * クライアントが認証情報を自動検出できる。
 */
const authMiddleware = requireBearerAuth({
  verifier: tokenVerifier,
  requiredScopes: [REQUIRED_SCOPE],
  resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
});

/**
 * MCPサーバーインスタンスを生成して返す。
 *
 * リクエストごとに新しいインスタンスを生成するステートレス構成。
 * セッションを持たないため水平スケールしやすい。
 *
 * @returns ツールが登録済みの {@link McpServer} インスタンス
 */
function createServer(): McpServer {
  const server = new McpServer({
    name: "mcp-auth",
    version: "1.0.0",
  });

  // ツール: 2つの数値を加算して返す
  server.registerTool(
    "sum_numbers",
    {
      title: "sum_numbers",
      description: "Sum two numbers",
      inputSchema: z.object({
        a: z.number().describe("first number"),
        b: z.number().describe("second number"),
      }),
      outputSchema: z.object({
        result: z.number().describe("sum result"),
      }),
    },
    async ({ a, b }) => {
      const result = a + b;
      return {
        content: [{ type: "text", text: `${a} + ${b} = ${result}` }],
        structuredContent: { result },
      };
    },
  );

  // ツール: このサーバーの認可ポリシー情報を返す（動作確認・デモ用）
  server.registerTool(
    "get_server_policy",
    {
      title: "get_server_policy",
      description: "Return simple authorization policy for demo",
      outputSchema: z.object({
        resource: z.string().describe("resource server url"),
        requiredScope: z.string().describe("required scope"),
      }),
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `resource=${RESOURCE_SERVER_URL}, requiredScope=mcp:tools`,
        },
      ],
      structuredContent: {
        resource: RESOURCE_SERVER_URL,
        requiredScope: "mcp:tools",
      },
    }),
  );

  return server;
}

/** ヘルスチェック用エンドポイント（認証不要）。 */
app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

/**
 * MCPエンドポイント（POST）。
 * 
 * `authMiddleware` → MCPハンドラーの順で処理される。
 * リクエストごとに {@link McpServer} と {@link NodeStreamableHTTPServerTransport} を
 * 生成・破棄するステートレス設計。
 */
app.post(MCP_PATH, authMiddleware, async (req, res) => {
  const server = createServer();
  const transport = new NodeStreamableHTTPServerTransport();

  try {
    // トランスポートをサーバーに接続してからリクエストを処理する
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    // ハンドラー内でのエラーをJSON-RPCエラー形式で返す
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: {
          code: -32603,
          message: "Internal server error",
          data: error instanceof Error ? error.message : String(error),
        },
        id: null,
      });
    }
  } finally {
    // リクエスト完了後に必ずリソースを解放する
    await transport.close();
    await server.close();
  }
});

/**
 * MCPエンドポイント（GET / DELETE）。
 * 
 * Streamable HTTP仕様上 GET（SSEストリーム）・DELETE（セッション終了）は存在するが、
 * このサンプルはステートレス構成のためセッションを持たず405を返す。
 * 認証チェック（`authMiddleware`）はGET/DELETEにも適用する。
 */
app.get(MCP_PATH, authMiddleware, (_req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );
});

app.delete(MCP_PATH, authMiddleware, (_req, res) => {
  res.writeHead(405).end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed." },
      id: null,
    }),
  );
});

app.listen(PORT, () => {
  console.error(`MCP endpoint: http://localhost:${PORT}${MCP_PATH}`);
  console.error(
    `PRM endpoint: ${getOAuthProtectedResourceMetadataUrl(mcpServerUrl)}`,
  );
  console.error(`Introspection endpoint: ${oauthMetadata.introspection_endpoint}`);
});

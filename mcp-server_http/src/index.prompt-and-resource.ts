import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { refineTransport } from "./transport.util.js";

const PORT = Number(process.env.PORT ?? "3000");

function createServer() {
  const server = new McpServer({ name: "todo-mcp-prompt", version: "1.0.0" });

  // リソース: アノテーション付きの静的リソース（テキストコンテンツ）
  const testGuideUri = "memory://guides/testcase-prompt-playbook";
  server.registerResource(
    "testcase-prompt-playbook",
    testGuideUri,
    {
      mimeType: "text/markdown",
      description: "テスト観点生成のガイド",
      annotations: {
        audience: ["assistant"],           // AIへの参照情報として位置づける
        priority: 0.8,                     // 重要度（高め）
        lastModified: "2026-06-28T00:00:00Z",
      },
    },
    async () => ({
      contents: [{
        uri: testGuideUri, mimeType: "text/markdown",
        text: [
          // 実務ではもっと細かい指示が必要になりますが、行数を抑えるため最小限に留めています
          "# APIテストケース作成ガイド",
          "- 仕様の観点: 正常系、代替系、異常系、境界値、認可、冪等性",
          "- 基本フローの正常系を中心に、代替系、異常系、その他の観点を付加する形にまとめる。",
          "- ユースケースの検証を主眼とし、入力値検証などは含めない（単体テストで担保する）",
          "- 必要に応じて分類しながら、箇条書きで簡潔にまとめる",
        ].join("\n")
      }]
    }),
  );

  // リソーステンプレート: URIのパラメータで内容が変わる動的リソース
  server.registerResource(
    "order-detail",
    new ResourceTemplate("orders://{orderId}/detail", {
      list: async () => ({
        resources: [
          { uri: "orders://O00001/detail", name: "O00001", mimeType: "application/json" },
          { uri: "orders://O00002/detail", name: "O00002", mimeType: "application/json" },
        ],
      }),
    }),
    { mimeType: "application/json", description: "受注詳細" },
    async (uri, { orderId }) => ({
      contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ orderId, status: "pending" }) }],
    }),
  );

  // プロンプト：コードレビュー指示をテンプレート化した例
  server.registerPrompt(
    "code-review-prompt",
    {
      title: "code-review-prompt",
      description: "コードレビュー指示",
      // 引数スキーマの定義：MCP InspectorなどのMCPクライアントのUIで入力フォームとして表示され、サーバー側の関数に渡されます。
      argsSchema: {
        specPath: z.string().describe("仕様書パス"),
        codePath: z.string().describe("対象コードパス"),
      },
    },
    async ({ specPath, codePath }) => {
      return {
        messages: [
          // user: プロンプト本文
          {
            role: "user",
            content: {
              type: "text",
              // 実務ではもっと細かい指示が必要になりますが、行数を抑えるため最小限に留めています
              text: [
                "コードレビュー指示",
                "あなたはNode.js/TypeScriptのバックエンド開発スペシャリストです。",
                "* 優先観点: 仕様整合性、例外設計、認可制御、トランザクション制御、性能、保守性、セキュリティ。",
                "* 禁止: 推測で仕様補完しない。根拠のない断定をしない。",
                "* 指摘の重大度: High(必須)/Medium(基本的に対応)/Low(できるだけ対応)を付ける。",
                "* 指摘は「問題」「対象個所」「修正案」を1行で示す。",
                "* 出力は最大10件、重複指摘は統合する。",
                "* 改善コードが必要なら最小差分で提案する。",
                `* 仕様書パス: ${specPath}`,
                `* 対象コードパス: ${codePath}`,
              ].join("\n"),
            },
          },
          // assistant: 見本
          {
            role: "assistant",
            content: {
              type: "text",
              text: ["（コードレビュー指摘の出力例）",
                "1. High: [問題] 仕様に記載のないAPIエンドポイントが存在する。 [対象個所] src/api/user.tsのgetUser関数。 [修正案] 不要なエンドポイントなら削除、仕様が古いなら更新して整合させる。",
                "2. Medium: [問題] 認可制御が不足しており、全ユーザーが管理者機能にアクセス可能。[対象個所] src/api/admin.tsのdeleteUser関数。[修正案] 認可制御を導入し、管理者権限を持つユーザーのみアクセス可能にする。",
                "3. Low: [問題] 例外処理が不十分で、500系エラー時にスタックトレースが返される可能性がある。[対象個所] src/api/order.tsのcreateOrder関数。[修正案] エラーハンドリングを追加し、ユーザー向けエラーメッセージのみ返す。",
              ].join("\n")
            },
          },
        ],
      };
    },
  );

  // プロンプト：ツール実行順序を定義したワークフローをテンプレート化した例
  server.registerPrompt(
    "inventory-check-workflow",
    {
      title: "inventory-check-workflow",
      description: "在庫確認ワークフロー",
      argsSchema: {
        orderNo: z.string().describe("受注番号"),
      },
    },
    async ({ orderNo }) => {
      const prompt = [
        "在庫確認ワークフロー",
        `1. tools/callでget-orderを実行してください。（引数 orderNo: "${orderNo}"）`,
        "2. tools/callでcheck-attached-inventoryを実行してください。（引数: orderId: 1のレスポンスのorderId, quantity: 1のレスポンスのquantityの合計）",
        "3. 2のレスポンスのavailableがtrueなら「在庫引当済み」、falseなら「在庫不足」と返してください。",
      ].join("\n")
      return { messages: [{ role: "user", content: { type: "text", text: prompt, } }] };
    },
  );
  server.registerTool(
    "get-order",
    {
      title: "get-order",
      description: "受注情報を取得する",
      inputSchema: {
        orderNo: z.string().describe("受注番号"),
      },
    },
    async ({ orderNo }) => {
      return {
        content: [
          { type: "text", text: [`orderId: O00001`, `orderNo: ${orderNo}`, `itemNo: I00002, quantity: 20`, `itemNo: I00003, quantity: 30`].join("\n") },
        ],
      };
    },
  );
  server.registerTool(
    "check-attached-inventory",
    {
      title: "check-attached-inventory",
      description: "在庫引き当て状況を確認する",
      inputSchema: {
        orderId: z.string().describe("受注ID"),
        quantity: z.number().describe("数量"),
      },
    },
    async ({ orderId, quantity }) => {
      const available = quantity <= 50; // 在庫数は50と仮定
      return {
        content: [
          { type: "text", text: [`orderId: ${orderId}`, `available: ${available}`].join("\n") },
        ],
      };
    },
  );

  return server;
}

const app = createMcpExpressApp();

async function boot() {
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport();

    res.on("close", async () => {
      try {
        await transport.close();
        await server.close();
      } catch (error) {
        console.error("Failed to close MCP transport/server:", error);
      }
    });

    try {
      await server.connect(refineTransport(server, transport));
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  });

  app.delete("/mcp", (_req, res) => {
    res.writeHead(405).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  });

  app.listen(PORT, () => {
    console.error(`Prompt/Resource MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

await boot();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { refineTransport } from "./transport.util.js";

const PORT = Number(process.env.PORT ?? "3000");
const promptGuideUri = "memory://guides/testcase-prompt-playbook";
const promptGuideText = [
  "# API Testcase Prompt Playbook",
  "- 仕様の観点: 正常系、境界値、異常系、認可、冪等性",
  "- 制約はテスト観点の優先順位に反映する",
  "- 最終出力は箇条書きで簡潔にまとめる",
].join("\n");

function createServer() {
  const server = new McpServer({ name: "todo-mcp-prompt", version: "1.0.0" });

  // リソース: プロンプト/ツール が参照する前提情報。
  server.registerResource(
    "testcase-prompt-playbook",
    promptGuideUri,
    { mimeType: "text/markdown", description: "テスト観点生成のガイド" },
    async () => ({ contents: [{ uri: promptGuideUri, text: promptGuideText }] }),
  );

  // プロンプト: ツール実行手順をテンプレート化。
  server.registerPrompt(
    "api-testcase-workflow",
    {
      title: "api-testcase-workflow",
      description: "Prompt + Resource + Tool を連動させたAPIテスト観点生成テンプレート",
      argsSchema: {
        feature: z.string().describe("対象機能名"),
        constraints: z.string().optional().describe("制約条件"),
        guideUri: z.string().optional().describe("ガイドURI"),
      },
    },
    async ({ feature, constraints, guideUri }) => {
      const targetGuideUri = guideUri ?? promptGuideUri;
      const constraintsLine = constraints ? `制約: ${constraints}` : "制約: なし";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: [
                "あなたはAPIテスト設計の支援担当です。",
                `対象機能: ${feature}`,
                constraintsLine,
                `先に resources/read で ${targetGuideUri} を読み、観点を揃えてください。`,
                "その後、tools/call で generate-testcase-checklist を実行し、feature と constraints を渡してください。",
                "最終出力は5件のテスト観点を箇条書きで返してください。",
              ].join("\n"),
            },
          },
        ],
      };
    },
  );

  // ツール: プロンプトから受けた引数で実行する処理。
  server.registerTool(
    "generate-testcase-checklist",
    {
      title: "generate-testcase-checklist",
      description: "機能名と制約を受け取り、APIテスト観点の下書きを返す",
      inputSchema: {
        feature: z.string().describe("対象機能名"),
        constraints: z.string().optional().describe("制約条件"),
      },
    },
    async ({ feature, constraints }) => {
      const checklist = [
        `- 正常系: ${feature} の代表フローが成功すること`,
        `- 境界値: ${feature} の入力上限/下限で正しく応答すること`,
        `- 異常系: 不正入力時にエラー形式が統一されること`,
        `- 認可: 権限不足ユーザーが拒否されること`,
        `- 冪等性: 同一リクエスト再送時の整合性が保たれること`,
      ];
      if (constraints) {
        checklist.push(`- 制約反映: ${constraints}`);
      }

      return {
        content: [
          { type: "text", text: [`feature: ${feature}`, `constraints: ${constraints ?? "none"}`, "guide:", promptGuideText, "checklist:", ...checklist].join("\n") },
        ],
      };
    },
  );

  // ツール: 出力整形の別責務例。
  server.registerTool(
    "draft-pr-summary",
    {
      title: "draft-pr-summary",
      description: "PR要約文のドラフトを作成する",
      inputSchema: {
        title: z.string().describe("PRタイトル"),
        changes: z.array(z.string()).min(1).describe("変更点"),
      },
    },
    async ({ title, changes }) => ({
      content: [
        { type: "text", text: [`# ${title}`, "", "## 変更内容", ...changes.map((change) => `- ${change}`)].join("\n") },
      ],
    }),
  );

  return server;
}

const app = createMcpExpressApp();

async function boot() {
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport();

    try {
      await server.connect(refineTransport(server, transport));
      await transport.handleRequest(req, res, req.body);
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.listen(PORT, () => {
    console.error(`Prompt/Resource MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

await boot();

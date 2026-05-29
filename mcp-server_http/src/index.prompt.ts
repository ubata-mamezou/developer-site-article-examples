import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { refineTransport } from "./transport.util.js";

const PORT = Number(process.env.PORT ?? "3000");

function createServer() {
  const server = new McpServer({
    name: "todo-mcp-prompt",
    version: "1.0.0",
  });

  // Prompt: reusable template for generating API test scenarios.
  server.registerPrompt(
    "api-testcase-template",
    {
      title: "api-testcase-template",
      description: "APIテスト観点を作るためのテンプレートプロンプト",
      argsSchema: {
        feature: z.string().describe("対象機能名"),
        constraints: z.string().optional().describe("制約条件"),
      },
    },
    async ({ feature, constraints }) => {
      const suffix = constraints ? ` 制約: ${constraints}` : "";
      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: `${feature} のAPIテスト観点を5件作成してください。${suffix}`,
            },
          },
        ],
      };
    },
  );

  // Tool: example execution endpoint using prompt-like structured inputs.
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
        {
          type: "text",
          text: [
            `# ${title}`,
            "",
            "## 変更内容",
            ...changes.map((change) => `- ${change}`),
          ].join("\n"),
        },
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
    console.error(`Prompt MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

await boot();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// サーバーのインスタンス化
const server = new McpServer({
  name: "hello-world-server",
  version: "1.0.0",
});

// ツールの登録
server.registerTool(
  "hello",
  {
    title: 'hello, world!',
    inputSchema: {
      name: z.string().describe("メッセージに追加する名前"),
    },
    outputSchema: {
      message: z.string().describe("メッセージ"),
    }
  },
  async ({ name }) => {
    return {
      content: [
        {
          type: "text",
          text: `Hello, ${name}!`,
        },
      ],
      structuredContent: {
        message: `Hello, ${name}!`,
      },
    };
  }
);

// 起動処理
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Hello World Server (Modern) running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});

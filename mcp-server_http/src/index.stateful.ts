import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { refineTransport } from "./transport.util.js";
import { ApplicationError } from "./application.error.js";

const PORT = Number(process.env.PORT ?? "3000");
const WEB_API_BASE_URL = process.env.WEB_API_BASE_URL ?? "http://localhost:3001";
const WEB_API_CALL_FAILED_MESSAGE = "WebAPI call failed";

function createServer() {
  // サーバーインスタンスの生成
  const server = new McpServer({
    name: "todo-mcp-stateful",
    version: "1.0.0",
  });

  // ツールの登録
  server.registerTool(
    "get_todo",
    {
      title: "get_todo",
      description: "Todoを1件取得する",
      inputSchema: {
        id: z.number().describe("TodoのID"),
      },
    },
    async ({ id }) => {
      const endpoint = `${WEB_API_BASE_URL}/todos/${id}`;
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(10_000),
        });
        // 登録を省略しているため、レスポンスの検証は省略しています。
        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (error) {
        const message = error instanceof ApplicationError ? error.message : WEB_API_CALL_FAILED_MESSAGE;
        return { content: [{ type: "text", text: message }] };
      }
    },
  );

  return server;
}

const app = createMcpExpressApp();
const server = createServer();
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});

// 起動処理
async function boot() {
  await server.connect(refineTransport(server, transport));

  app.post("/mcp", async (req, res) => {
    try {
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

  app.listen(PORT, (error?: Error) => {
    if (error) {
      console.error("Failed to start stateful server:", error);
      process.exit(1);
    }
    console.error(`Stateful MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

process.on("SIGINT", async () => {
  await transport.close();
  await server.close();
  process.exit(0);
});

await boot();

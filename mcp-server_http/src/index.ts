import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { json, z } from "zod";

const MCP_PORT = Number(process.env.PORT ?? "3000");
const DEFAULT_WEB_API_BASE_URL = "http://localhost:3001";

function createServer() {
  // サーバーのインスタンス化
  const server = new McpServer({
    name: "hello-world-server",
    version: "1.0.0",
  });

  // ツールの登録
  const baseUrl = `${process.env.WEB_API_BASE_URL ?? DEFAULT_WEB_API_BASE_URL}/todos`;

  server.registerTool(
    "health_check",
    {
      title: "health_check",
      description: "Todo APIのヘルスチェックを行う",
    },
    async () => {
      const endpoint = `${baseUrl}`;
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `WebAPI call failed: ${endpoint}` }] };
      }

    }
  );


  server.registerTool(
    "get_todo",
    {
      title: "get_todo",
      description: "Todoを取得する",
      inputSchema: {
        id: z.number().describe("TodoのID"),
      },
    },
    async ({ id }) => {
      const endpoint = `${baseUrl}/${id}`;
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `WebAPI call failed: ${endpoint}` }] };
      }

    }
  );

  server.registerTool(
    "list_todo",
    {
      title: "list_todo",
      description: "Todoリストを取得する",
    },
    async () => {
      const endpoint = `${baseUrl}`;
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `WebAPI call failed: ${endpoint}` }] };
      }

    }
  );

  server.registerTool(
    "register_todo",
    {
      title: "register_todo",
      description: "Todoを登録する",
      inputSchema: {
        title: z.string().describe("Todoのタイトル"),
        source: z.string().describe("Todoの登録元"),
      },
    },
    async ({ title, source }) => {
      const endpoint = `${baseUrl}`;
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title, source }),
        });

        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `WebAPI call failed: ${endpoint}` }] };
      }

    }
  );

  server.registerTool(
    "done_todo",
    {
      title: "done_todo",
      description: "Todoを完了にする",
      inputSchema: {
        id: z.number().describe("TodoのID"),
      },
    },
    async ({ id }) => {
      const endpoint = `${baseUrl}/${id}/done`;
      try {
        const response = await fetch(endpoint, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
        });

        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `WebAPI call failed: ${endpoint}` }] };
      }

    }
  );

  // server.registerTool(
  //   "fetch_web_api",
  //   {
  //     title: "fetch_web_api",
  //     description: "外部WebAPIに接続してデータ取得を行う",
  //     inputSchema: {
  //       path: z.string().default("/todos/1").describe("WebAPIのパス。例: /todos/1"),
  //     },
  //     outputSchema: {
  //       endpoint: z.string().describe("呼び出し先エンドポイント"),
  //       status: z.number().describe("HTTPステータス"),
  //       body: z.unknown().describe("レスポンスボディ"),
  //     },
  //   },
  //   async ({ path }) => {
  //     const baseUrl = process.env.WEB_API_BASE_URL ?? DEFAULT_WEB_API_BASE_URL;
  //     const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  //     const endpoint = `${baseUrl}${normalizedPath}`;

  //     try {
  //       const response = await fetch(endpoint, {
  //         method: "GET",
  //         signal: AbortSignal.timeout(10_000),
  //       });

  //       const body = await response.json();
  //       return {
  //         content: [
  //           {
  //             type: "text",
  //             text: `WebAPI call success: ${endpoint} (status: ${response.status})`,
  //           },
  //         ],
  //         structuredContent: {
  //           endpoint,
  //           status: response.status,
  //           body,
  //         },
  //       };
  //     } catch (error) {
  //       const message = error instanceof Error ? error.message : "unknown error";
  //       return {
  //         content: [
  //           {
  //             type: "text",
  //             text: `WebAPI call failed: ${endpoint} (${message})`,
  //           },
  //         ],
  //         structuredContent: {
  //           endpoint,
  //           status: 0,
  //           body: { error: message },
  //         },
  //       };
  //     }
  //   },
  // );

  return server;
}

const app = createMcpExpressApp();

// Streamable HTTP の設定と起動
async function boot() {
  app.post("/mcp", async (req, res) => {
    const server = createServer();

    try {
      // Stateless mode: セッションIDを使わず 1リクエスト単位で処理
      const transport = new StreamableHTTPServerTransport();

      await server.connect(transport as Parameters<typeof server.connect>[0]);
      await transport.handleRequest(req, res, req.body);

      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/mcp", (_req, res) => {
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      }),
    );
  });

  app.delete("/mcp", (_req, res) => {
    res.writeHead(405).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Method not allowed.",
        },
        id: null,
      }),
    );
  });

  app.listen(MCP_PORT, (error?: Error) => {
    if (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }

    console.error("MCP Hello World Server (Streamable HTTP) running");
    console.error(`MCP Server listening on http://localhost:${MCP_PORT}`);
    console.error(`MCP endpoint: http://localhost:${MCP_PORT}/mcp`);
  });
}

try {
  await boot();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}

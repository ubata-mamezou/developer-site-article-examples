import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { json, z } from "zod";
import { id, th } from "zod/locales";
import { refineTransport } from "./transport.util.js";

const MCP_PORT = Number(process.env.PORT ?? "3000");
const DEFAULT_WEB_API_BASE_URL = "http://localhost:3001";
class ApplicationError extends Error {
  constructor(message: string) {
    super(message);
  }
}
const BASE_URL = `${process.env.WEB_API_BASE_URL ?? DEFAULT_WEB_API_BASE_URL}/todos`;

function createServer() {
  // サーバーインスタンスの生成
  const server = new McpServer({
    name: "hello-world-server",
    version: "1.0.0",
  });

  // ツールの登録
  server.registerTool(
    "health_check",
    {
      title: "health_check",
      description: "Todo APIのヘルスチェックを行う",
    },
    async () => {
      const endpoint = `${BASE_URL}/health`;
      try {
        const response = await fetch(endpoint, {method: "GET", headers: {"Content-Type": "application/json"}});
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
      const endpoint = `${BASE_URL}/${id}`;
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
    "get_todo_by_no",
    {
      title: "get_todo_by_no",
      description: "Todoを取得する",
      inputSchema: {
        no: z.string().describe("Todoの番号"),
      },
    },
    async ({ no }) => {
      try {
        return { content: [{ type: "text", text: JSON.stringify(await searchTodo(no)) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof ApplicationError ? error.message : "An unexpected error occurred." }] };
      }
    }
  );

  const searchTodo = async (no: string) => {
    const endpoint = `${BASE_URL}/search`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ no }),
      });
      const bodies = await response.json();
      if (bodies.length !== 1) {
        throw new ApplicationError("指定された受注番号は見つかりませんでした。");
      }
      return bodies[0];
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(`WebAPI call failed: ${endpoint}`);
    }
  };

  server.registerTool(
    "list_todo",
    {
      title: "list_todo",
      description: "Todoリストを取得する",
    },
    async () => {
      const endpoint = `${BASE_URL}`;
      try {
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });
        const bodies = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(bodies) }] };
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
      const endpoint = `${BASE_URL}`;
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
        no: z.string().describe("Todoの番号"),
      },
    },
    async ({ no }) => {
      try {
        const targetTodo = await searchTodo(no);
        const endpoint = `${BASE_URL}/${targetTodo.id}/done`;
        console.log(`Calling endpoint: ${endpoint}`);
        const response = await fetch(endpoint, {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
        });
        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof ApplicationError ? error.message : "An unexpected error occurred." }] };
      }
    }
  );

  return server;
}

const app = createMcpExpressApp();

// 起動処理
async function boot() {
  // POSTリクエストを受け付けるエンドポイント
  app.post("/mcp", async (req, res) => { 
    const server = createServer();

    try {
      const transport = new StreamableHTTPServerTransport(); // トランスポート設定
      await server.connect(refineTransport(server, transport));
      await transport.handleRequest(req, res, req.body);

      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      console.error("Error handling MCP request:", error);
      if (!res.headersSent) res.status(500).json({jsonrpc: "2.0", error: {code: -32603, message: "Internal server error"}, id: null});
    }
  });

  // GETリクエストを抑止
  app.get("/mcp", (_req, res) => { 
    res.writeHead(405).end(JSON.stringify({jsonrpc: "2.0", error: {code: -32000, message: "Method not allowed."}, id: null}));
  });

  // DELETEリクエストを抑止
  app.delete("/mcp", (_req, res) => {
    res.writeHead(405).end(JSON.stringify({jsonrpc: "2.0", error: {code: -32000, message: "Method not allowed."}, id: null}));
  });

  // ポートにバインド
  app.listen(MCP_PORT, (error?: Error) => {
    if (error) {
      console.error("Failed to start server:", error);
      process.exit(1);
    }

    console.log("MCP Hello World Server (Streamable HTTP) running");
    console.log(`MCP Server listening on http://localhost:${MCP_PORT}`);
    console.log(`MCP endpoint: http://localhost:${MCP_PORT}/mcp`);
  });
}

try {
  await boot();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}

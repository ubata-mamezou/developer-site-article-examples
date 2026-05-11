import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? "3000");
const WEB_API_BASE_URL = process.env.WEB_API_BASE_URL ?? "http://localhost:3001";

function createServer() {
  const server = new McpServer({
    name: "todo-mcp-stateless",
    version: "1.0.0",
  });

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
        const body = await response.json();
        return { content: [{ type: "text", text: JSON.stringify(body) }] };
      } catch {
        return { content: [{ type: "text", text: `WebAPI call failed: ${endpoint}` }] };
      }
    },
  );

  return server;
}

const app = createMcpExpressApp();

async function boot() {
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport();

    try {
      await server.connect(transport as Parameters<typeof server.connect>[0]);
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
    } finally {
      await transport.close();
      await server.close();
    }
  });

  app.listen(PORT, (error?: Error) => {
    if (error) {
      console.error("Failed to start stateless server:", error);
      process.exit(1);
    }
    console.error(`Stateless MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

await boot();

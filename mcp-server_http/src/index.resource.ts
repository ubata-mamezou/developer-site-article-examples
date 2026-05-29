import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { refineTransport } from "./transport.util.js";

const PORT = Number(process.env.PORT ?? "3000");

const guideUri = "memory://guides/backend-coding";
const guideText = [
  "# Backend Coding Guide",
  "- Use strict TypeScript types.",
  "- Return user-facing errors with actionable messages.",
  "- Keep external API calls timeout-aware.",
].join("\n");

function createServer() {
  const server = new McpServer({
    name: "todo-mcp-resource",
    version: "1.0.0",
  });

  // Resource: static guide text that clients can read and cache.
  server.registerResource(
    "backend-coding-guide",
    guideUri,
    { mimeType: "text/markdown", description: "バックエンド実装ガイド" },
    async () => ({
      contents: [{ uri: guideUri, text: guideText }],
    }),
  );

  // Tool: sample that uses the guide content as generation hints.
  server.registerTool(
    "generate-snippet-with-guide",
    {
      title: "generate-snippet-with-guide",
      description: "ガイドラインを前提にコードスニペット案を返す",
      inputSchema: {
        topic: z.string().describe("生成したいトピック"),
      },
    },
    async ({ topic }) => ({
      content: [
        {
          type: "text",
          text: [
            `topic: ${topic}`,
            "guide:",
            guideText,
            "snippet:",
            `export function create${topic.replace(/\s+/g, "")}Handler() { /* ... */ }`,
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
    console.error(`Resource MCP endpoint: http://localhost:${PORT}/mcp`);
  });
}

await boot();

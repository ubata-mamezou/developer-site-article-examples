import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const PORT = Number(process.env.PORT ?? "3010");
const app = createMcpExpressApp();
const ORDER_API_BASE_URL = process.env.ORDER_API_BASE_URL ?? `http://localhost:${PORT}`;

type OrderStatus = "CREATED" | "PICKING" | "SHIPPED" | "DELIVERED";

type OrderRecord = {
  orderId: string;
  customer: string;
  amount: number;
};

type OrderApiResponse = {
  orderId: string;
  customer: string;
  amount: number;
  status: OrderStatus;
  updatedAt: string;
};

const orderStore: Record<string, OrderRecord> = {
  O001: { orderId: "O001", customer: "A Corp", amount: 120000 },
  O002: { orderId: "O002", customer: "B Corp", amount: 56000 },
  O003: { orderId: "O003", customer: "C Corp", amount: 340000 },
};

const statuses: OrderStatus[] = ["CREATED", "PICKING", "SHIPPED", "DELIVERED"];

function currentStatus(): OrderStatus {
  const slot = Math.floor(Date.now() / 30000) % statuses.length;
  return statuses[slot];
}

async function fetchOrderFromRest(orderId: string): Promise<OrderApiResponse | null> {
  const response = await fetch(`${ORDER_API_BASE_URL}/api/orders/${encodeURIComponent(orderId)}`);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`order api error: ${response.status}`);
  }
  return (await response.json()) as OrderApiResponse;
}

app.get("/api/orders/:orderId", (req, res) => {
  const orderId = String(req.params.orderId ?? "").toUpperCase();
  const order = orderStore[orderId];
  if (!order) {
    res.status(404).json({ message: `order not found: ${orderId}` });
    return;
  }

  const payload: OrderApiResponse = {
    ...order,
    status: currentStatus(),
    updatedAt: new Date().toISOString(),
  };
  res.json(payload);
});

function createServer() {
  const server = new McpServer({ name: "mcp-agent-bridge", version: "1.0.0" });

  server.registerTool(
    "search_order",
    {
      title: "search_order",
      description: "受注IDで受注APIを参照し、最新の受注情報を取得する",
      inputSchema: {
        orderId: z.string().describe("受注ID"),
      },
    },
    async ({ orderId }) => {
      const normalizedOrderId = orderId.toUpperCase();
      const order = await fetchOrderFromRest(normalizedOrderId);
      if (!order) {
        return {
          content: [{ type: "text", text: `order not found: ${normalizedOrderId}` }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ source: "order-api", ...order }),
          },
        ],
        structuredContent: {
          source: "order-api",
          ...order,
        },
      };
    },
  );

  return server;
}

app.post("/mcp", async (req, res) => {
  const server = createServer();
  const transport = new StreamableHTTPServerTransport();

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } finally {
    await transport.close();
    await server.close();
  }
});

app.listen(PORT, () => {
  console.error(`MCP agent bridge endpoint: http://localhost:${PORT}/mcp`);
  console.error(`Mock order API endpoint: http://localhost:${PORT}/api/orders/O001`);
});

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function getAvailablePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  assert.ok(address && typeof address !== "string");
  return address.port;
}

async function waitForApi(url, serverProcess) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`MCP server exited with code ${serverProcess.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry until the server has finished starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Mock order API did not start: ${url}`);
}

test("search_order returns an order from the mock API", async (t) => {
  const port = await getAvailablePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const serverProcess = spawn(process.execPath, ["dist/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(port),
      ORDER_API_BASE_URL: baseUrl,
    },
    stdio: "ignore",
  });
  const client = new Client(
    { name: "mcp-agent-bridge-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`));

  t.after(async () => {
    await transport.close().catch(() => {});
    if (serverProcess.exitCode === null && serverProcess.signalCode === null) {
      serverProcess.kill();
      await once(serverProcess, "exit");
    }
  });

  await waitForApi(`${baseUrl}/api/orders/O001`, serverProcess);
  await client.connect(transport);

  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "search_order"));

  const result = await client.callTool({
    name: "search_order",
    arguments: { orderId: "o001" },
  });
  assert.equal(result.structuredContent.orderId, "O001");
  assert.equal(result.structuredContent.amount, 120000);
  assert.equal(result.structuredContent.source, "order-api");
});
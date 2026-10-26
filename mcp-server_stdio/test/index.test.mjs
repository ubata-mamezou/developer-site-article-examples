import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

test("hello tool returns the expected text and structured result", async (t) => {
  const client = new Client(
    { name: "mcp-server-stdio-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: projectRoot,
  });

  t.after(async () => {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
  });

  await client.connect(transport);
  const result = await client.callTool({
    name: "hello",
    arguments: { name: "Test" },
  });

  assert.equal(result.content[0].text, "Hello, Test!");
  assert.deepEqual(result.structuredContent, { message: "Hello, Test!" });
});
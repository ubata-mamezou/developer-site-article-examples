import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));

async function getAvailablePorts(count) {
  const servers = Array.from({ length: count }, () => createServer());
  await Promise.all(
    servers.map((server) => new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))),
  );
  const ports = servers.map((server) => {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    return address.port;
  });
  await Promise.all(
    servers.map(
      (server) => new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    ),
  );
  return ports;
}

async function waitForEndpoint(url, isReady, childProcesses) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    for (const child of childProcesses) {
      if (child.exitCode !== null) {
        throw new Error(`Server exited with code ${child.exitCode}`);
      }
    }
    try {
      const response = await fetch(url);
      if (isReady(response)) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Server did not become ready: ${url}`);
}

async function stopProcess(child) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, "exit");
  }
}

test("Todo tools register, list, and complete a Todo through the Web API", async (t) => {
  const [apiPort, mcpPort] = await getAvailablePorts(2);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}`;
  const mcpEndpoint = `http://127.0.0.1:${mcpPort}/mcp`;
  const apiProcess = spawn(process.execPath, ["dist/sample-web-api.js"], {
    cwd: projectRoot,
    env: { ...process.env, WEB_API_PORT: String(apiPort) },
    stdio: "ignore",
  });
  const mcpProcess = spawn(process.execPath, ["dist/index.js"], {
    cwd: projectRoot,
    env: {
      ...process.env,
      PORT: String(mcpPort),
      WEB_API_BASE_URL: apiBaseUrl,
    },
    stdio: "ignore",
  });
  const client = new Client(
    { name: "mcp-server-http-test", version: "1.0.0" },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint));

  t.after(async () => {
    await client.close().catch(() => {});
    await stopProcess(mcpProcess);
    await stopProcess(apiProcess);
  });

  await waitForEndpoint(`${apiBaseUrl}/health`, (response) => response.ok, [apiProcess]);
  await waitForEndpoint(mcpEndpoint, (response) => response.status === 405, [mcpProcess]);
  await client.connect(transport);

  const tools = await client.listTools();
  assert.ok(tools.tools.some((tool) => tool.name === "register_todo"));

  const registered = await client.callTool({
    name: "register_todo",
    arguments: { title: "Verify MCP HTTP", source: "npm test" },
  });
  const todo = JSON.parse(registered.content[0].text);
  assert.equal(todo.title, "Verify MCP HTTP");
  assert.equal(todo.source, "npm test");
  assert.equal(todo.completed, false);

  const listed = await client.callTool({ name: "list_todo", arguments: {} });
  assert.ok(JSON.parse(listed.content[0].text).some((item) => item.id === todo.id));

  const completed = await client.callTool({
    name: "done_todo",
    arguments: { no: todo.no },
  });
  assert.equal(JSON.parse(completed.content[0].text).completed, true);
});
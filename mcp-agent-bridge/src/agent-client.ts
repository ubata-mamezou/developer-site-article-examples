import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const MCP_ENDPOINT = process.env.MCP_ENDPOINT ?? "http://localhost:3010/mcp";
const LLM_BASE_URL = process.env.LLM_BASE_URL ?? "https://api.openai.com/v1";
const LLM_MODEL = process.env.LLM_MODEL ?? "gpt-4.1-mini";
const LLM_API_KEY = process.env.OPENAI_API_KEY ?? "";

type AgentPlan =
  | { tool: "search_order"; arguments: { orderId: string }; reason: string }
  | { tool: "none"; message: string };

function extractOrderIdFromQuery(query: string): string | null {
  const matched = query.match(/O\d{3}/i);
  return matched?.[0]?.toUpperCase() ?? null;
}

function buildFallbackPlan(query: string): AgentPlan {
  const orderId = extractOrderIdFromQuery(query);
  if (!orderId) {
    return {
      tool: "none",
      message: "受注IDを解釈できませんでした。例: 受注O001の状況を教えて",
    };
  }

  return {
    tool: "search_order",
    arguments: { orderId },
    reason: "ユーザー入力から受注IDを抽出したため",
  };
}

async function callLlm(messages: Array<{ role: "system" | "user" | "assistant"; content: string }>): Promise<string> {
  const response = await fetch(`${LLM_BASE_URL}/chat/completions?key=${LLM_API_KEY}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0,
      messages,
    }),
  });

  const data = await response.json();
  console.log(data);

  if (!response.ok) {
    throw new Error(`llm api error: ${response.status}`);
  }

  const payload = data as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content?.trim() ?? "";
}

async function buildLlmPlan(query: string): Promise<AgentPlan> {
  const schemaPrompt = [
    "You are an agent planner.",
    "Return JSON only.",
    "If query includes order ID like O001, return:",
    '{"tool":"search_order","arguments":{"orderId":"O001"},"reason":"..."}',
    "If no order ID exists, return:",
    '{"tool":"none","message":"..."}',
  ].join(" ");

  const raw = await callLlm([
    { role: "system", content: schemaPrompt },
    { role: "user", content: query },
  ]);

  try {
    const parsed = JSON.parse(raw) as Partial<AgentPlan> & { arguments?: { orderId?: string } };
    if (parsed.tool === "search_order") {
      const orderId = parsed.arguments?.orderId?.toUpperCase();
      if (orderId && /^O\d{3}$/.test(orderId)) {
        return {
          tool: "search_order",
          arguments: { orderId },
          reason: parsed.reason ?? "LLM planning",
        };
      }
    }
    if (parsed.tool === "none") {
      return { tool: "none", message: parsed.message ?? "必要な情報が不足しています。" };
    }
  } catch {
    // fallback below
  }

  return buildFallbackPlan(query);
}

async function buildPlan(query: string): Promise<AgentPlan> {
  if (!LLM_API_KEY) {
    return buildFallbackPlan(query);
  }

  try {
    return await buildLlmPlan(query);
  } catch {
    return buildFallbackPlan(query);
  }
}

async function callSearchOrderTool(client: Client, orderId: string) {
  const result = await client.callTool({
    name: "search_order",
    arguments: { orderId },
  });
  return result;
}

function parseToolJson(textPayload: string): Record<string, unknown> | null {
  try {
    return JSON.parse(textPayload) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function buildFinalAnswer(query: string, toolText: string): Promise<string> {
  if (!LLM_API_KEY) {
    const parsed = parseToolJson(toolText);
    if (!parsed) {
      return `受注照会結果: ${toolText}`;
    }
    return `受注${String(parsed.orderId ?? "")}: 状態=${String(parsed.status ?? "-")}, 更新時刻=${String(parsed.updatedAt ?? "-")}`;
  }

  const answer = await callLlm([
    {
      role: "system",
      content: "あなたは業務アシスタントです。tool結果だけを根拠に、簡潔な日本語で回答してください。",
    },
    { role: "user", content: `ユーザー質問: ${query}\n\ntool結果JSON: ${toolText}` },
  ]);
  return answer || `受注照会結果: ${toolText}`;
}

async function connectMcpClient() {
  const client = new Client({ name: "agent-simulator", version: "1.0.0" }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_ENDPOINT));

  await client.connect(transport);
  const tools = await client.listTools();
  const hasSearchOrder = tools.tools.some((tool) => tool.name === "search_order");
  if (!hasSearchOrder) {
    await transport.close();
    throw new Error("search_order tool is not published by MCP server.");
  }

  return { client, transport };
}

async function runAgentTurn(client: Client, query: string) {
  const plan = await buildPlan(query);

  if (plan.tool === "none") {
    return {
      query,
      plan,
      answer: plan.message,
      toolResult: null,
    };
  }

  const toolResult = await callSearchOrderTool(client, plan.arguments.orderId);
  const toolText = extractTextPayload(toolResult);
  const answer = await buildFinalAnswer(query, toolText);

  return {
    query,
    plan,
    answer,
    toolResult: toolText,
  };
}

async function runSingleShot(client: Client, query: string) {
  const result = await runAgentTurn(client, query);

  console.log(
    JSON.stringify(
      {
        mode: "single-shot",
        mcpEndpoint: MCP_ENDPOINT,
        llmEnabled: Boolean(LLM_API_KEY),
        ...result,
      },
      null,
      2,
    ),
  );
}

async function runChatMode(client: Client) {
  const rl = createInterface({ input, output });
  try {
    console.error("[agent] chat mode started. 終了するには exit と入力してください。");
    console.error(`[agent] MCP endpoint: ${MCP_ENDPOINT}`);
    console.error(`[agent] LLM enabled: ${Boolean(LLM_API_KEY)}`);

    while (true) {
      const query = (await rl.question("you> ")).trim();
      if (!query) {
        continue;
      }
      if (query.toLowerCase() === "exit") {
        break;
      }

      const result = await runAgentTurn(client, query);
      console.log(
        JSON.stringify(
          {
            mode: "chat",
            ...result,
          },
          null,
          2,
        ),
      );
    }
  } finally {
    rl.close();
  }
}

function extractTextPayload(result: unknown): string {
  if (typeof result !== "object" || result === null) {
    return "";
  }

  const maybeContent = (result as { content?: unknown }).content;
  if (!Array.isArray(maybeContent)) {
    return "";
  }

  const firstText = maybeContent.find(
    (item): item is { type: "text"; text: string } =>
      typeof item === "object" &&
      item !== null &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  );

  return firstText?.text ?? "";
}

async function main() {
  const { client, transport } = await connectMcpClient();
  try {
    const query = process.argv.slice(2).join(" ").trim();
    if (query) {
      await runSingleShot(client, query);
      return;
    }

    await runChatMode(client);
  } finally {
    await transport.close();
  }
}

void main();

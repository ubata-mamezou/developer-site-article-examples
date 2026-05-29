# mcp-agent-bridge

人 -> AIエージェント -> MCP -> REST integration validation sample.

## Run

```bash
npm install
npm run start
```

`start` and `agent` scripts automatically load `.env` when it exists.

## Quick LLM setup (Ollama)

1. Start Ollama and pull a model.

```bash
ollama pull llama3.1:8b
```

2. Create `.env` from `.env.example` and keep these values.

```env
OPENAI_API_KEY=ollama
LLM_BASE_URL=http://localhost:11434/v1
LLM_MODEL=llama3.1:8b
```

3. Run MCP server and agent.

```bash
# Terminal A
npm run start

# Terminal B
npm run agent
```

Server endpoint:

- http://localhost:3010/mcp
- http://localhost:3010/api/orders/O001 (mock order API)

## Included tools

- `search_order`: Calls REST API and returns latest order data.

## Included agent client

- `agent-client`: Accepts natural-language query, extracts order ID, and calls MCP tool.
- Chat mode available: human can interactively instruct the agent from terminal.

## Verification idea

1. Terminal A: Start MCP server
2. Terminal B: Start chat-driven agent client
3. Enter a natural-language request
4. Confirm agent output contains MCP plan and tool result

```bash
# Terminal A
npm run start

# Terminal B
npm run agent
# then type: 受注O001の最新状況を教えて
```

Single-shot mode is also available:

```bash
npm run agent -- "受注O001の最新状況を教えて"
```

## Notes

- Without `OPENAI_API_KEY`, the agent uses fallback parsing (regex for order IDs).
- With `OPENAI_API_KEY`, planner/answer generation uses Chat Completions API.
- In production, replace the mock `/api/orders/:orderId` endpoint with your existing order API URL by setting `ORDER_API_BASE_URL`.
- `.env.example` is included as a template for local setup.

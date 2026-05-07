import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// サーバーのインスタンス化
const server = new McpServer({
  name: "hello-world-server",
  version: "1.0.0",
});

// ツールの登録
/*
 * 基本的な動作確認を目的としたツール。
 */
server.registerTool(
  "hello",
  {
    title: "hello, world!",
    inputSchema: { name: z.string().describe("メッセージに追加する名前") }, // 入力スキーマの定義
    outputSchema: { message: z.string().describe("メッセージ") }, // 出力スキーマの定義
  },
  async ({ name }) => {
    return {
      content: [{ type: "text", text: `Hello, ${name}!` }], // デフォルトのレスポンス
      structuredContent: { message: `Hello, ${name}!` }, // 出力スキーマに基づくレスポンス
    };
  },
);

/**
 * デバッグログを出力した場合の挙動を確認するだけのツール
 */
server.registerTool(
  `output_log`,
  { title: 'output_log' },
  async () => {
    console.log('debug log'); // to stdout
    console.info('info log'); // to stdout
    console.warn('warn log'); // to stderr
    console.error('error log'); // to stderr
    return { content: [{ type: "text", text: 'output log tool' }] };
  },
);

// 起動処理
async function boot() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Hello World Server (Modern) running on stdio"); // 標準出力にログを出力するとエラーになるため、`console.error`を使用しています
}

try {
  await boot();
} catch (error) {
  console.error("Fatal error:", error);
  process.exit(1);
}

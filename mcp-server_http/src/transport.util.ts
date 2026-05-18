import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp";
import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp";

/**
 * `StreamableHTTPServerTransport`を`Transport`に変換する
 * 
 * `StreamableHTTPServerTransport`と`Transport`に差異があるため、これを吸収するユーティリティ
 * @param server MCPサーバーインスタンス
 * @param transport StreamableHTTPServerTransportのインスタンス
 * @returns Transportインスタンス
 */
export const refineTransport = (server: McpServer, transport: StreamableHTTPServerTransport) => {
  return transport as Parameters<typeof server.connect>[0];
};

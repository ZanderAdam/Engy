// MCP response envelope helpers, shared by every register*Tools module.
// All content is JSON-encoded text — tools never return raw objects.

type McpToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

export function mcpResult(data: unknown): McpToolResult {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

export function mcpError(message: string): McpToolResult {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

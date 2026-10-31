const MCP_URL_ORIGIN_RE = /(https?:\/\/[^/\s'"]+)\/mcp\//;

export function deriveMcpOrigin(callerCommand: string | undefined): string {
  const match = callerCommand ? MCP_URL_ORIGIN_RE.exec(callerCommand) : null;
  return match ? match[1] : `http://localhost:${process.env.PORT ?? '3000'}`;
}

export function terminalLink(origin: string, sessionId: string): string {
  return `${origin}/t/${encodeURIComponent(sessionId)}`;
}

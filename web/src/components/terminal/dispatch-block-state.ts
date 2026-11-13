interface AgentRow {
  sessionId: string;
  dispatchOptOut: boolean;
}

export function dispatchBlockState(
  agents: readonly AgentRow[],
  activeSessionId: string | undefined,
): { enabled: boolean; blocked: boolean } {
  const active = agents.find((agent) => agent.sessionId === activeSessionId);
  return { enabled: active !== undefined, blocked: active?.dispatchOptOut === true };
}

interface AgentRow {
  sessionId: string;
  orchestrator: boolean;
  workspaceSlug?: string;
  projectSlug?: string;
}

interface DockProject {
  workspaceSlug?: string;
  projectSlug?: string;
}

type OrchestratorButtonAction = { kind: 'focus'; sessionId: string } | { kind: 'start' };

export function orchestratorButtonAction(
  agents: readonly AgentRow[],
  dock: DockProject,
): OrchestratorButtonAction {
  const orchestrator = agents.find(
    (agent) =>
      agent.orchestrator &&
      agent.workspaceSlug === dock.workspaceSlug &&
      agent.projectSlug === dock.projectSlug,
  );
  return orchestrator ? { kind: 'focus', sessionId: orchestrator.sessionId } : { kind: 'start' };
}

'use client';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  listAgentTypes,
  isAgentActive,
  resolveAgentMode,
  DEFAULT_PLAN_SKILL,
  DEFAULT_IMPLEMENT_SKILL,
  type AgentSettings,
  type AgentTypeId,
  type WorkspaceAgentSettings,
} from '@/lib/agent-types';

/**
 * Editing state for the Agents tab, seeded from the stored per-agent settings.
 * Legacy workspace-level skills (columns that pre-date per-agent settings)
 * surface in the claude entry so the first save migrates them forward.
 */
export function seedAgentSettings(workspace: {
  agentSettings: WorkspaceAgentSettings | null;
  planSkill: string | null;
  implementSkill: string | null;
}): WorkspaceAgentSettings {
  const seeded: WorkspaceAgentSettings = structuredClone(workspace.agentSettings ?? {});
  const claude: AgentSettings = { ...seeded.claude };
  if (claude.planSkill == null && workspace.planSkill != null) {
    claude.planSkill = workspace.planSkill;
  }
  if (claude.implementSkill == null && workspace.implementSkill != null) {
    claude.implementSkill = workspace.implementSkill;
  }
  seeded.claude = claude;
  return seeded;
}

/** Trim skill inputs, drop empty fields, and drop entries with nothing set. */
export function normalizeAgentSettings(
  value: WorkspaceAgentSettings,
): Record<string, AgentSettings> {
  const normalized: Record<string, AgentSettings> = {};
  for (const [agentId, entry] of Object.entries(value)) {
    if (!entry) continue;
    const cleaned: AgentSettings = {};
    if (entry.active !== undefined) cleaned.active = entry.active;
    if (entry.mode) cleaned.mode = entry.mode;
    const planSkill = entry.planSkill?.trim();
    const implementSkill = entry.implementSkill?.trim();
    if (planSkill) cleaned.planSkill = planSkill;
    if (implementSkill) cleaned.implementSkill = implementSkill;
    if (Object.keys(cleaned).length > 0) normalized[agentId] = cleaned;
  }
  return normalized;
}

interface AgentSettingsTabProps {
  defaultAgentType: AgentTypeId;
  onDefaultAgentTypeChange: (id: AgentTypeId) => void;
  agentWorktrees: boolean;
  onAgentWorktreesChange: (next: boolean) => void;
  value: WorkspaceAgentSettings;
  onChange: (next: WorkspaceAgentSettings) => void;
}

export function AgentSettingsTab({
  defaultAgentType,
  onDefaultAgentTypeChange,
  agentWorktrees,
  onAgentWorktreesChange,
  value,
  onChange,
}: AgentSettingsTabProps) {
  const agents = listAgentTypes();

  return (
    <div className="flex flex-col gap-4 pt-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="workspace-default-agent">Default agent</Label>
        <p className="text-xs text-muted-foreground">
          Agent CLI new terminals launch by default. Pick a different one per terminal from the New
          Terminal menu.
        </p>
        <Select
          value={defaultAgentType}
          onValueChange={(id: AgentTypeId) => onDefaultAgentTypeChange(id)}
        >
          <SelectTrigger id="workspace-default-agent">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {agents
              .filter((agent) => isAgentActive(value, agent.id))
              .map((agent) => (
                <SelectItem key={agent.id} value={agent.id}>
                  {agent.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="workspace-agent-worktrees">Agent worktrees</Label>
          <Switch
            id="workspace-agent-worktrees"
            checked={agentWorktrees}
            onCheckedChange={onAgentWorktreesChange}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Implement quick actions tell the agent to create its own git worktree and work inside it.
          Background executions always get a worktree, and terminals already scoped to one are left
          alone.
        </p>
      </div>

      <Tabs defaultValue={defaultAgentType} className="flex flex-col gap-2">
        <TabsList>
          {agents.map((agent) => (
            <TabsTrigger key={agent.id} value={agent.id}>
              {agent.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {agents.map((agent) => {
          const entry = value[agent.id] ?? {};
          const isDefault = agent.id === defaultAgentType;
          const mode = resolveAgentMode(value, agent.id);
          const modeDescription = agent.modes.find((m) => m.id === mode)?.description;
          const patch = (fields: Partial<AgentSettings>) =>
            onChange({ ...value, [agent.id]: { ...entry, ...fields } });

          return (
            <TabsContent key={agent.id} value={agent.id}>
              <div className="flex flex-col gap-4 pt-2">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`agent-active-${agent.id}`}>Active</Label>
                    <Switch
                      id={`agent-active-${agent.id}`}
                      checked={isAgentActive(value, agent.id)}
                      disabled={isDefault}
                      onCheckedChange={(active) => patch({ active })}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {isDefault
                      ? 'The default agent is always active.'
                      : 'Inactive agents are hidden from terminal menus and cannot be spawned by other agents.'}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor={`agent-mode-${agent.id}`}>Default mode</Label>
                  <Select value={mode} onValueChange={(m) => patch({ mode: m })}>
                    <SelectTrigger id={`agent-mode-${agent.id}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {agent.modes.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {modeDescription && (
                    <p className="text-xs text-muted-foreground">{modeDescription}</p>
                  )}
                </div>

                <div className="flex flex-col gap-2">
                  <Label>Task skills</Label>
                  <p className="text-xs text-muted-foreground">
                    Slash commands invoked by the Plan/Implement buttons.
                  </p>
                  <Input
                    aria-label={`${agent.label} plan skill`}
                    value={entry.planSkill ?? ''}
                    onChange={(e) => patch({ planSkill: e.target.value })}
                    placeholder={`${DEFAULT_PLAN_SKILL} (plan)`}
                  />
                  <Input
                    aria-label={`${agent.label} implement skill`}
                    value={entry.implementSkill ?? ''}
                    onChange={(e) => patch({ implementSkill: e.target.value })}
                    placeholder={`${DEFAULT_IMPLEMENT_SKILL} (implement)`}
                  />
                </div>
              </div>
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}

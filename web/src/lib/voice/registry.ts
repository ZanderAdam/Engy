export interface VoiceActionParam {
  name: string;
  description?: string;
}

export interface VoiceActionContext {
  params: Record<string, string>;
}

export interface VoiceAction {
  id: string;
  title: string;
  phrases: string[];
  params?: VoiceActionParam[];
  run: (ctx: VoiceActionContext) => void | Promise<void>;
}

export class VoiceActionRegistry {
  private readonly actions = new Map<string, VoiceAction>();

  register(action: VoiceAction): void {
    if (this.actions.has(action.id)) {
      throw new Error(`Voice action "${action.id}" is already registered.`);
    }
    this.actions.set(action.id, action);
  }

  unregister(id: string): void {
    this.actions.delete(id);
  }

  get(id: string): VoiceAction | undefined {
    return this.actions.get(id);
  }

  list(): VoiceAction[] {
    return [...this.actions.values()];
  }

  clear(): void {
    this.actions.clear();
  }
}

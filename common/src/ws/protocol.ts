export interface RegisterMessage {
  type: 'REGISTER';
  payload: Record<string, never>;
}

export interface WorkspacesSyncMessage {
  type: 'WORKSPACES_SYNC';
  payload: {
    workspaces: Array<{
      slug: string;
      repos: string[];
    }>;
  };
}

export interface ValidatePathsRequestMessage {
  type: 'VALIDATE_PATHS_REQUEST';
  payload: {
    requestId: string;
    paths: string[];
  };
}

export interface ValidatePathsResponseMessage {
  type: 'VALIDATE_PATHS_RESPONSE';
  payload: {
    requestId: string;
    results: Array<{
      path: string;
      exists: boolean;
    }>;
  };
}

export interface FileChangeMessage {
  type: 'FILE_CHANGE';
  payload: {
    workspaceSlug: string;
    path: string;
    eventType: 'add' | 'change' | 'unlink';
  };
}

export type WsMessage =
  | RegisterMessage
  | WorkspacesSyncMessage
  | ValidatePathsRequestMessage
  | ValidatePathsResponseMessage
  | FileChangeMessage;

export type ClientToServerMessage =
  | RegisterMessage
  | ValidatePathsResponseMessage
  | FileChangeMessage;

export type ServerToClientMessage = WorkspacesSyncMessage | ValidatePathsRequestMessage;

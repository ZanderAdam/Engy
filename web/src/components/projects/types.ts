export interface Task {
  id: number;
  projectId: number | null;
  milestoneRef: string | null;
  taskGroupId: number | null;
  title: string;
  description: string | null;
  status: string;
  type: string;
  importance: string | null;
  urgency: string | null;
  subStatus: string | null;
  needsPlan: boolean;
  specId: string | null;
  createdAt: string;
  updatedAt: string;
}

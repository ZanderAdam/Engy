"use client";

import { useMemo, useRef, useState } from "react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { DynamicDocumentEditor } from "@/components/editor/dynamic-document-editor";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { taskStatusOptions, taskStatusColors } from "./task-status-badge";
import { RiAddLine, RiCloseLine, RiDeleteBinLine } from "@remixicon/react";
import { toast } from "sonner";
import { useExecutionStatus } from "@/hooks/use-execution-status";
import { ExecutionTab } from "./execution-tab";

// ── Create mode ──────────────────────────────────────────────────────

interface CreateProps {
  mode: "create";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId?: number;
  specId?: string;
  onCreated?: () => void;
}

// ── Edit mode ────────────────────────────────────────────────────────

interface EditProps {
  mode: "edit";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: number;
}

type TaskDialogProps = CreateProps | EditProps;

export function TaskDialog(props: TaskDialogProps) {
  if (props.mode === "edit") {
    return <EditTask key={props.taskId} {...props} />;
  }
  return <CreateTask {...props} />;
}

function useTaskProjectContext(projectId?: number) {
  const { data: project } = trpc.project.get.useQuery(
    { id: projectId! },
    { enabled: !!projectId },
  );
  const { data: workspaces } = trpc.workspace.list.useQuery();

  return useMemo(() => {
    if (!project || !workspaces) {
      return {
        mentionDirs: undefined,
        workspaceId: undefined as number | undefined,
        workspaceSlug: undefined as string | undefined,
        projectSlug: undefined as string | undefined,
      };
    }
    const workspace = workspaces.find((w) => w.id === project.workspaceId);
    const dirs = [
      ...((workspace?.repos as string[] | undefined) ?? []),
      ...(project.projectDir ? [project.projectDir] : []),
    ];
    return {
      mentionDirs: dirs.length > 0 ? dirs : undefined,
      workspaceId: project.workspaceId,
      workspaceSlug: workspace?.slug,
      projectSlug: project.slug,
    };
  }, [project, workspaces]);
}

// ── Create ───────────────────────────────────────────────────────────

function CreateTask({ open, onOpenChange, projectId, specId, onCreated }: CreateProps) {
  const [title, setTitle] = useState("");
  const descriptionRef = useRef("");
  const { mentionDirs } = useTaskProjectContext(projectId);
  const [type, setType] = useState<"ai" | "human">("human");
  const [importance, setImportance] = useState<"important" | "not_important">("not_important");
  const [urgency, setUrgency] = useState<"urgent" | "not_urgent">("not_urgent");
  const [needsPlan, setNeedsPlan] = useState(true);
  const [blockedBy, setBlockedBy] = useState<number[]>([]);
  const [taskGroupId, setTaskGroupId] = useState<number | undefined>(undefined);

  const { data: projectTasks } = trpc.task.list.useQuery(
    { projectId: projectId! },
    { enabled: !!projectId && open },
  );
  const { data: groups } = trpc.taskGroup.list.useQuery({}, { enabled: open });

  const createTask = trpc.task.create.useMutation({
    onSuccess: () => {
      setTitle("");
      descriptionRef.current = "";
      setType("human");
      setImportance("not_important");
      setUrgency("not_urgent");
      setNeedsPlan(true);
      setBlockedBy([]);
      setTaskGroupId(undefined);
      onCreated?.();
    },
  });

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!title.trim()) return;
    createTask.mutate({
      projectId,
      specId,
      title: title.trim(),
      description: descriptionRef.current.trim() || undefined,
      type,
      importance,
      urgency,
      needsPlan,
      blockedBy,
      taskGroupId,
    });
  }

  const availableTasks = projectTasks?.filter((t) => !blockedBy.includes(t.id)) ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[60vw] max-w-4xl [&>*]:min-w-0">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>New Task</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 py-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="task-title">Title</Label>
              <Input
                id="task-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Task title"
                autoFocus
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Description</Label>
              <div className="min-h-[200px] max-h-[50vh] overflow-auto border border-border">
                {open && (
                  <DynamicDocumentEditor
                    initialMarkdown=""
                    onSave={(md: string) => { descriptionRef.current = md; }}
                    mentionDirs={mentionDirs}
                  />
                )}
              </div>
            </div>

            <div className="flex items-center gap-4">
              <FieldRow type={type} importance={importance} urgency={urgency} needsPlan={needsPlan}
                onTypeChange={setType} onImportanceChange={setImportance} onUrgencyChange={setUrgency}
                onNeedsPlanChange={setNeedsPlan}
              />

              {groups && groups.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <Label>Task Group</Label>
                  <Select
                    value={taskGroupId?.toString() ?? "none"}
                    onValueChange={(v) => setTaskGroupId(v === "none" ? undefined : Number(v))}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue placeholder="None" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {groups.map((g) => (
                        <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {projectTasks && projectTasks.length > 0 && (
              <BlockedBySelector
                blockedBy={blockedBy}
                availableTasks={availableTasks}
                onAdd={(id) => setBlockedBy((prev) => [...prev, id])}
                onRemove={(id) => setBlockedBy((prev) => prev.filter((x) => x !== id))}
              />
            )}
          </div>

          <DialogFooter>
            <Button type="submit" disabled={!title.trim() || createTask.isPending}>
              {createTask.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── Edit ─────────────────────────────────────────────────────────────

function EditTask({ open, onOpenChange, taskId }: EditProps) {
  const { data: task } = trpc.task.get.useQuery(
    { id: taskId },
    { enabled: open },
  );
  const { mentionDirs, workspaceId, workspaceSlug, projectSlug } = useTaskProjectContext(
    task?.projectId ?? undefined,
  );

  const taskSlug = workspaceSlug ? `${workspaceSlug}-T${taskId}` : undefined;
  const { data: projectWithPlans } = trpc.project.getBySlug.useQuery(
    { workspaceId: workspaceId!, slug: projectSlug! },
    { enabled: !!workspaceId && !!projectSlug },
  );
  const hasPlan = taskSlug ? (projectWithPlans?.planSlugs ?? []).includes(taskSlug) : false;
  const planFilePath = taskSlug ? `plans/${taskSlug}.plan.md` : '';

  const { data: planData } = trpc.project.readFile.useQuery(
    { workspaceSlug: workspaceSlug!, projectSlug: projectSlug!, filePath: planFilePath },
    { enabled: hasPlan && !!workspaceSlug && !!projectSlug },
  );

  const { status: executionStatus, sessionId } = useExecutionStatus('task', taskId);
  const hasExecution = !!sessionId;

  const [title, setTitle] = useState(task?.title ?? "");
  const [status, setStatus] = useState(task?.status ?? "");
  const [type, setType] = useState<"ai" | "human">((task?.type as "ai" | "human") ?? "human");
  const [importance, setImportance] = useState<"important" | "not_important">((task?.importance as "important" | "not_important") ?? "not_important");
  const [urgency, setUrgency] = useState<"urgent" | "not_urgent">((task?.urgency as "urgent" | "not_urgent") ?? "not_urgent");
  const [needsPlan, setNeedsPlan] = useState(task?.needsPlan ?? true);
  const [description, setDescription] = useState(task?.description ?? "");
  const [blockedBy, setBlockedBy] = useState<number[]>(task?.blockedBy ?? []);
  const [taskGroupIdLocal, setTaskGroupIdLocal] = useState<number | null>(task?.taskGroupId ?? null);
  const [dirty, setDirty] = useState(false);
  const [initialized, setInitialized] = useState(!!task);

  if (task && !initialized) {
    setInitialized(true);
    setTitle(task.title);
    setStatus(task.status);
    setType(task.type as "ai" | "human");
    setImportance((task.importance ?? "not_important") as "important" | "not_important");
    setUrgency((task.urgency ?? "not_urgent") as "urgent" | "not_urgent");
    setNeedsPlan(task.needsPlan ?? true);
    setDescription(task.description || "");
    setBlockedBy(task.blockedBy ?? []);
    setTaskGroupIdLocal(task.taskGroupId ?? null);
  }

  const { data: projectTasks } = trpc.task.list.useQuery(
    { projectId: task?.projectId ?? 0 },
    { enabled: !!task?.projectId },
  );
  const { data: groups } = trpc.taskGroup.list.useQuery({}, { enabled: open });

  const utils = trpc.useUtils();
  const writePlan = trpc.project.writeFile.useMutation({
    onSuccess: () => utils.project.readFile.invalidate({
      workspaceSlug: workspaceSlug!,
      projectSlug: projectSlug!,
      filePath: planFilePath,
    }),
    onError: () => toast.error("Failed to save plan"),
  });

  function handlePlanSave(md: string) {
    if (!workspaceSlug || !projectSlug) return;
    writePlan.mutate({ workspaceSlug, projectSlug, filePath: planFilePath, content: md });
  }
  const updateTask = trpc.task.update.useMutation({
    onSuccess: () => {
      setDirty(false);
      utils.task.get.invalidate();
      utils.task.list.invalidate();
      utils.task.listBySpecId.invalidate();
    },
  });

  const deleteTask = trpc.task.delete.useMutation({
    onSuccess: () => {
      utils.task.list.invalidate();
      utils.task.listBySpecId.invalidate();
      onOpenChange(false);
    },
  });

  function handleSave() {
    if (!task) return;
    updateTask.mutate({
      id: task.id,
      title,
      status: status as (typeof taskStatusOptions)[number],
      type,
      importance,
      urgency,
      needsPlan,
      description,
      blockedBy,
      taskGroupId: taskGroupIdLocal,
    });
  }

  if (!task) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[60vw] max-w-4xl [&>*]:min-w-0">
          <DialogHeader>
            <DialogTitle>Loading...</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    );
  }

  const availableTasks = projectTasks?.filter(
    (t) => t.id !== taskId && !blockedBy.includes(t.id),
  ) ?? [];

  const descriptionEditor = (
    <div className="min-h-[200px] max-h-[50vh] overflow-auto border border-border">
      <DynamicDocumentEditor
        initialMarkdown={task.description || ""}
        onSave={(md: string) => { setDescription(md); setDirty(true); }}
        mentionDirs={mentionDirs}
      />
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[60vw] max-w-4xl [&>*]:min-w-0">
        <DialogHeader>
          <DialogTitle className="sr-only">Edit Task</DialogTitle>
          <Input
            value={title}
            onChange={(e) => { setTitle(e.target.value); setDirty(true); }}
            className="mt-6 text-lg font-semibold"
          />
        </DialogHeader>

        <Tabs defaultValue={hasExecution && !hasPlan ? "execution" : "description"}>
          <TabsList variant="line">
            <TabsTrigger value="description">Description</TabsTrigger>
            {hasPlan && <TabsTrigger value="plan">Plan</TabsTrigger>}
            {hasExecution && <TabsTrigger value="execution">Execution</TabsTrigger>}
          </TabsList>
          <TabsContent value="description">
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium">Status</label>
                  <Select
                    value={status}
                    onValueChange={(v) => { setStatus(v); setDirty(true); }}
                  >
                    <SelectTrigger className="h-7 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {taskStatusOptions.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s.replace("_", " ")}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <FieldRow
                  type={type}
                  importance={importance}
                  urgency={urgency}
                  needsPlan={needsPlan}
                  onTypeChange={(v) => { setType(v); setDirty(true); }}
                  onImportanceChange={(v) => { setImportance(v); setDirty(true); }}
                  onUrgencyChange={(v) => { setUrgency(v); setDirty(true); }}
                  onNeedsPlanChange={(v) => { setNeedsPlan(v); setDirty(true); }}
                />

                {groups && groups.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium">Task Group</label>
                    <Select
                      value={taskGroupIdLocal?.toString() ?? "none"}
                      onValueChange={(v) => {
                        setTaskGroupIdLocal(v === "none" ? null : Number(v));
                        setDirty(true);
                      }}
                    >
                      <SelectTrigger className="h-7 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {groups.map((g) => (
                          <SelectItem key={g.id} value={g.id.toString()}>{g.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {descriptionEditor}

              <BlockedBySelector
                blockedBy={blockedBy}
                availableTasks={availableTasks}
                onAdd={(id) => { setBlockedBy((prev) => [...prev, id]); setDirty(true); }}
                onRemove={(id) => { setBlockedBy((prev) => prev.filter((x) => x !== id)); setDirty(true); }}
              />
            </div>
          </TabsContent>
          {hasPlan && (
            <TabsContent value="plan">
              <div className="min-h-[200px] max-h-[50vh] overflow-auto border border-border">
                {planData && (
                  <DynamicDocumentEditor
                    initialMarkdown={planData.content}
                    onSave={handlePlanSave}
                    mentionDirs={mentionDirs}
                  />
                )}
              </div>
            </TabsContent>
          )}
          {hasExecution && (
            <TabsContent value="execution">
              <ExecutionTab
                taskId={taskId}
                sessionId={sessionId!}
                status={executionStatus}
              />
            </TabsContent>
          )}
        </Tabs>

        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => deleteTask.mutate({ id: task.id })}
          >
            <RiDeleteBinLine className="mr-1 size-3" />
            Delete
          </Button>
          <Button size="sm" disabled={!dirty || updateTask.isPending} onClick={handleSave}>
            {updateTask.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Shared ───────────────────────────────────────────────────────────

function FieldRow({
  type, importance, urgency, needsPlan,
  onTypeChange, onImportanceChange, onUrgencyChange, onNeedsPlanChange,
}: {
  type: "ai" | "human";
  importance: "important" | "not_important";
  urgency: "urgent" | "not_urgent";
  needsPlan: boolean;
  onTypeChange: (v: "ai" | "human") => void;
  onImportanceChange: (v: "important" | "not_important") => void;
  onUrgencyChange: (v: "urgent" | "not_urgent") => void;
  onNeedsPlanChange: (v: boolean) => void;
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label>Type</Label>
        <Select value={type} onValueChange={(v) => onTypeChange(v as "ai" | "human")}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="human">Human</SelectItem>
            <SelectItem value="ai">AI</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Importance</Label>
        <Select value={importance} onValueChange={(v) => onImportanceChange(v as "important" | "not_important")}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="important">Important</SelectItem>
            <SelectItem value="not_important">Not Important</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Urgency</Label>
        <Select value={urgency} onValueChange={(v) => onUrgencyChange(v as "urgent" | "not_urgent")}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="urgent">Urgent</SelectItem>
            <SelectItem value="not_urgent">Not Urgent</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Needs Plan</Label>
        <Select value={needsPlan ? "yes" : "no"} onValueChange={(v) => onNeedsPlanChange(v === "yes")}>
          <SelectTrigger className="h-7 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Yes</SelectItem>
            <SelectItem value="no">No</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );
}

function BlockedBySelector({
  blockedBy,
  availableTasks,
  onAdd,
  onRemove,
}: {
  blockedBy: number[];
  availableTasks: { id: number; title: string; status: string }[];
  onAdd: (id: number) => void;
  onRemove: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium">Blocked By</label>
      {blockedBy.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {blockedBy.map((id) => (
            <BlockerBadge key={id} taskId={id} onRemove={() => onRemove(id)} />
          ))}
        </div>
      )}
      {availableTasks.length > 0 && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-7 w-fit gap-1 text-xs">
              <RiAddLine className="size-3" />
              Add blocker...
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0" align="start">
            <Command>
              <CommandInput placeholder="Filter tasks..." className="h-8 text-xs" />
              <CommandList>
                <CommandEmpty>No tasks found.</CommandEmpty>
                <CommandGroup>
                  {availableTasks.map((t) => (
                    <CommandItem
                      key={t.id}
                      value={`${t.id} ${t.title}`}
                      onSelect={() => { onAdd(t.id); setOpen(false); }}
                      className="text-xs"
                    >
                      <span className="text-muted-foreground">#{t.id}</span> {t.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function BlockerBadge({ taskId, onRemove }: { taskId: number; onRemove: () => void }) {
  const { data: task } = trpc.task.get.useQuery({ id: taskId });

  return (
    <Badge
      variant="outline"
      className={cn("text-[10px] gap-1", task ? taskStatusColors[task.status] : "")}
    >
      #{taskId} {task?.title ?? "..."}
      <button
        type="button"
        onClick={onRemove}
        className="ml-0.5 hover:text-destructive"
      >
        <RiCloseLine className="size-3" />
      </button>
    </Badge>
  );
}

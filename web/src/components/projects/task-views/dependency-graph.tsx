"use client";

import { useMemo } from "react";
import { TaskCard } from "@/components/projects/task-card";
import type { Task as BaseTask } from "@/components/projects/types";

type Task = BaseTask & { blockedBy: number[] };

const statusNodeColors: Record<string, string> = {
  todo: "border-muted-foreground/30",
  in_progress: "border-blue-500",
  review: "border-yellow-500",
  done: "border-green-500",
};

const groupColors = [
  "bg-blue-500/5",
  "bg-green-500/5",
  "bg-purple-500/5",
  "bg-orange-500/5",
  "bg-pink-500/5",
];

function topoSort(tasks: Task[]): { layers: number[][]; taskMap: Map<number, Task> } {
  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const inDegree = new Map<number, number>();
  const adj = new Map<number, number[]>();

  for (const t of tasks) {
    inDegree.set(t.id, 0);
    adj.set(t.id, []);
  }

  for (const t of tasks) {
    const deps = t.blockedBy.filter((d) => taskMap.has(d));
    inDegree.set(t.id, deps.length);
    for (const d of deps) {
      adj.get(d)!.push(t.id);
    }
  }

  const layers: number[][] = [];
  let queue = [...inDegree.entries()].filter(([, d]) => d === 0).map(([id]) => id);

  while (queue.length > 0) {
    layers.push(queue);
    const next: number[] = [];
    for (const id of queue) {
      for (const child of adj.get(id) ?? []) {
        const newDeg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, newDeg);
        if (newDeg === 0) next.push(child);
      }
    }
    queue = next;
  }

  // Tasks with unresolvable cycles go in last layer
  const placed = new Set(layers.flat());
  const remaining = tasks.filter((t) => !placed.has(t.id)).map((t) => t.id);
  if (remaining.length > 0) layers.push(remaining);

  return { layers, taskMap };
}

export function DependencyGraph({
  tasks,
  onTaskClick,
}: {
  tasks: Task[];
  onTaskClick?: (taskId: number) => void;
}) {
  const { layers, taskMap } = useMemo(() => topoSort(tasks), [tasks]);

  const groupIds = useMemo(() => {
    const ids = new Set<number | null>();
    tasks.forEach((t) => ids.add(t.taskGroupId));
    return [...ids];
  }, [tasks]);

  const groupColorMap = useMemo(() => {
    const map = new Map<number | null, string>();
    groupIds.forEach((id, i) => {
      map.set(id, groupColors[i % groupColors.length]);
    });
    return map;
  }, [groupIds]);

  const COL_WIDTH = 184;
  const ROW_HEIGHT = 56;
  const PAD_LEFT = 92;
  const PAD_TOP = 40;

  const nodePositions = useMemo(() => {
    const positions = new Map<number, { x: number; y: number }>();
    layers.forEach((layer, col) => {
      layer.forEach((taskId, row) => {
        positions.set(taskId, {
          x: PAD_LEFT + col * COL_WIDTH,
          y: PAD_TOP + row * ROW_HEIGHT,
        });
      });
    });
    return positions;
  }, [layers]);

  const edges = useMemo(() => {
    const result: { from: number; to: number }[] = [];
    for (const t of tasks) {
      for (const dep of t.blockedBy.filter((d) => taskMap.has(d))) {
        result.push({ from: dep, to: t.id });
      }
    }
    return result;
  }, [tasks, taskMap]);

  if (tasks.length === 0) {
    return <p className="py-8 text-center text-xs text-muted-foreground">No tasks</p>;
  }

  return (
    <div className="relative" style={{ minHeight: 200 }}>
      <svg
        className="pointer-events-none absolute inset-0 h-full w-full"
        style={{ overflow: "visible" }}
      >
        {edges.map(({ from, to }) => {
          const fromPos = nodePositions.get(from);
          const toPos = nodePositions.get(to);
          if (!fromPos || !toPos) return null;
          return (
            <line
              key={`${from}-${to}`}
              x1={fromPos.x}
              y1={fromPos.y}
              x2={toPos.x}
              y2={toPos.y}
              stroke="currentColor"
              strokeOpacity={0.2}
              strokeWidth={1}
              markerEnd="url(#arrowhead)"
            />
          );
        })}
        <defs>
          <marker id="arrowhead" markerWidth="6" markerHeight="4" refX="6" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="currentColor" fillOpacity={0.3} />
          </marker>
        </defs>
      </svg>

      <div className="flex gap-6 overflow-x-auto p-4">
        {layers.map((layer, col) => (
          <div key={col} className="flex shrink-0 flex-col gap-2" style={{ minWidth: 160 }}>
            <span className="text-[10px] text-muted-foreground">Layer {col + 1}</span>
            {layer.map((taskId) => {
              const task = taskMap.get(taskId)!;
              return (
                <TaskCard
                  key={taskId}
                  task={task}
                  onClick={() => onTaskClick?.(taskId)}
                  borderClass={statusNodeColors[task.status]}
                  className={groupColorMap.get(task.taskGroupId)}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

"use client";

import { cn } from "@/lib/utils";

export type TaskView = "kanban" | "eisenhower" | "graph";

const views: { value: TaskView; label: string }[] = [
  { value: "kanban", label: "Kanban" },
  { value: "eisenhower", label: "Eisenhower" },
  { value: "graph", label: "Graph" },
];

export function ViewToggle({
  value,
  onChange,
}: {
  value: TaskView;
  onChange: (view: TaskView) => void;
}) {
  return (
    <div data-slot="view-toggle" className="inline-flex border border-border">
      {views.map((v) => (
        <button
          key={v.value}
          type="button"
          onClick={() => onChange(v.value)}
          className={cn(
            "px-3 py-1.5 text-xs font-medium transition-colors",
            value === v.value
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

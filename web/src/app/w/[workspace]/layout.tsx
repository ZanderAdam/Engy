"use client";

import { useParams, usePathname } from "next/navigation";
import Link from "next/link";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";

const tabs = [
  { label: "Overview", segment: "" },
  { label: "Tasks", segment: "tasks" },
  { label: "Docs", segment: "docs" },
  { label: "Memory", segment: "memory" },
] as const;

export default function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ workspace: string }>();
  const pathname = usePathname();
  const { data: workspace, isLoading, error } = trpc.workspace.get.useQuery(
    { slug: params.workspace },
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-sm text-muted-foreground">Loading workspace...</p>
      </div>
    );
  }

  if (error || !workspace) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 py-20">
        <p className="text-sm font-medium">Workspace not found</p>
        <p className="text-xs text-muted-foreground">
          The workspace &ldquo;{params.workspace}&rdquo; does not exist.
        </p>
        <Link href="/" className="mt-2 text-xs text-primary underline">
          Back to home
        </Link>
      </div>
    );
  }

  const basePath = `/w/${params.workspace}`;
  const isProjectRoute = pathname.startsWith(`${basePath}/projects/`);

  function tabHref(segment: string): string {
    return segment ? `${basePath}/${segment}` : basePath;
  }

  function isActive(segment: string): boolean {
    if (segment === "") return pathname === basePath;
    return pathname.startsWith(`${basePath}/${segment}`);
  }

  return (
    <div className="flex flex-1 flex-col">
      {!isProjectRoute && (
        <nav className="border-b border-border" aria-label="Workspace sections">
          <div className="mx-auto flex w-[95%] max-w-[1800px]">
            {tabs.map((tab) => (
              <Link
                key={tab.segment}
                href={tabHref(tab.segment)}
                className={cn(
                  "relative px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground",
                  isActive(tab.segment) &&
                    "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground",
                )}
              >
                {tab.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
      <div className="mx-auto flex min-h-0 flex-1 flex-col w-[95%] max-w-[1800px]">{children}</div>
    </div>
  );
}

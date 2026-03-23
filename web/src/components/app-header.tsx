"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ThemeToggle } from "@/components/theme-toggle";
import { QuestionList } from "@/components/questions/question-list";
import { QuestionDialog } from "@/components/questions/question-dialog";
import { trpc } from "@/lib/trpc";
import { RiQuestionLine } from "@remixicon/react";

interface BreadcrumbEntry {
  label: string;
  href: string;
  tooltip?: string;
}

function useBreadcrumbs(): BreadcrumbEntry[] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: BreadcrumbEntry[] = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const href = "/" + segments.slice(0, i + 1).join("/");

    if (segment === "w" && segments[i + 1]) continue;
    if (segment === "projects") continue;

    crumbs.push({ label: segment, href });
  }

  if (segments[0] === "open") {
    const dirPath = searchParams.get("path");
    if (dirPath) {
      const dirName = dirPath.split("/").filter(Boolean).pop() ?? dirPath;
      crumbs.push({
        label: dirName,
        href: `/open?path=${encodeURIComponent(dirPath)}`,
        tooltip: dirPath,
      });
    }
  }

  return crumbs;
}

export function AppHeader() {
  const crumbs = useBreadcrumbs();
  const { data: unansweredData } = trpc.question.unansweredCount.useQuery({});
  const unansweredCount = unansweredData?.count ?? 0;
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);

  useEffect(() => {
    document.title =
      crumbs.length > 0 ? `engy:${crumbs.map((c) => c.label).join(':')}` : 'engy';
  }, [crumbs]);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            {crumbs.length === 0 ? (
              <BreadcrumbPage>
                <span className="text-sm font-semibold tracking-tight">engy</span>
              </BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link href="/">
                  <span className="text-sm font-semibold tracking-tight">engy</span>
                </Link>
              </BreadcrumbLink>
            )}
          </BreadcrumbItem>
          {crumbs.map((crumb, i) => {
            const isLast = i === crumbs.length - 1;
            const content = isLast ? (
              <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
            ) : (
              <BreadcrumbLink asChild>
                <Link href={crumb.href}>{crumb.label}</Link>
              </BreadcrumbLink>
            );

            return (
              <Fragment key={crumb.href}>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  {crumb.tooltip ? (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>{content}</TooltipTrigger>
                        <TooltipContent side="bottom">
                          <p className="font-mono">{crumb.tooltip}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  ) : (
                    content
                  )}
                </BreadcrumbItem>
              </Fragment>
            );
          })}
        </BreadcrumbList>
      </Breadcrumb>
      <div className="flex items-center gap-2">
        {unansweredCount > 0 && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="relative flex items-center justify-center rounded p-1 transition-colors hover:bg-muted"
              >
                <RiQuestionLine className="size-4 text-muted-foreground" />
                <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold leading-none text-white">
                  {unansweredCount}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-0" align="end">
              <div className="border-b border-border px-3 py-2">
                <p className="text-xs font-medium">Unanswered Questions</p>
              </div>
              <QuestionList
                onSelectTask={(taskId) => {
                  setPopoverOpen(false);
                  setSelectedTaskId(taskId);
                }}
              />
            </PopoverContent>
          </Popover>
        )}
        <ThemeToggle />
      </div>
      {selectedTaskId !== null && (
        <QuestionDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedTaskId(null);
          }}
          taskId={selectedTaskId}
        />
      )}
    </header>
  );
}

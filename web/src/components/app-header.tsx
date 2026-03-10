"use client";

import { Fragment } from "react";
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
import { ThemeToggle } from "@/components/theme-toggle";

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
      <ThemeToggle />
    </header>
  );
}

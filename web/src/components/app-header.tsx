"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

function useBreadcrumbs() {
  const pathname = usePathname();
  const segments = pathname.split("/").filter(Boolean);

  const crumbs: Array<{ label: string; href: string }> = [];

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const href = "/" + segments.slice(0, i + 1).join("/");

    if (segment === "w" && segments[i + 1]) continue;
    if (segment === "projects") continue;

    crumbs.push({ label: segment, href });
  }

  return crumbs;
}

export function AppHeader() {
  const crumbs = useBreadcrumbs();

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border px-4">
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
          {crumbs.map((crumb, i) => (
            <Fragment key={crumb.href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {i === crumbs.length - 1 ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useVirtualParams } from "@/components/tabs/tab-context";

export default function SpecsRedirectPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/w/${params.workspace}`);
  }, [params.workspace, router]);

  return null;
}

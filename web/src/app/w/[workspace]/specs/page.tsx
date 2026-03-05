"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function SpecsRedirectPage() {
  const params = useParams<{ workspace: string }>();
  const router = useRouter();

  useEffect(() => {
    router.replace(`/w/${params.workspace}`);
  }, [params.workspace, router]);

  return null;
}

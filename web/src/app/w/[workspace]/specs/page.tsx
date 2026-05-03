"use client";

import { useEffect, useRef } from "react";
import { useVirtualNavigate, useVirtualParams } from "@/components/tabs/tab-context";

export default function SpecsRedirectPage() {
  const params = useVirtualParams<{ workspace: string }>();
  const nav = useVirtualNavigate();
  const navRef = useRef(nav);

  useEffect(() => {
    navRef.current = nav;
  });

  useEffect(() => {
    navRef.current.push(`/w/${params.workspace}`);
  }, [params.workspace]);

  return null;
}

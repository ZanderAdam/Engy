"use client";

import dynamic from "next/dynamic";

export const DynamicDocumentEditor = dynamic(
  () => import("./document-editor").then((mod) => mod.DocumentEditor),
  { ssr: false },
);

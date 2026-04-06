"use client";

import { forwardRef, type ComponentProps } from "react";
import dynamic from "next/dynamic";
import type { DocumentEditor, DocumentEditorHandle } from "./document-editor";

export type { DocumentEditorHandle };

type Props = ComponentProps<typeof DocumentEditor>;

const LoadableDocumentEditor = dynamic(
  () => import("./document-editor").then((mod) => mod.DocumentEditor),
  { ssr: false },
) as unknown as React.ForwardRefExoticComponent<
  Props & React.RefAttributes<DocumentEditorHandle>
>;

// Explicit forwardRef wrapper — next/dynamic historically dropped refs.
export const DynamicDocumentEditor = forwardRef<DocumentEditorHandle, Props>(
  function DynamicDocumentEditor(props, ref) {
    return <LoadableDocumentEditor {...props} ref={ref} />;
  },
);

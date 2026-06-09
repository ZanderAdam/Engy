'use client';

import Image from 'next/image';
import { RiDownloadLine } from '@remixicon/react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

interface ImagePreviewProps {
  /** `data:` URI of the image to display. */
  dataUri: string;
  /** File name shown in the header and used as the download name. */
  fileName: string;
}

/** Read-only viewer for image documents selected in a file tree. */
export function ImagePreview({ dataUri, fileName }: ImagePreviewProps) {
  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground">{fileName}</span>
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={dataUri}
                download={fileName}
                className="flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
              >
                <RiDownloadLine className="size-3.5" />
              </a>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              <p>Download image</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted/30">
        <Image
          src={dataUri}
          alt={fileName}
          fill
          unoptimized
          sizes="100vw"
          className="object-contain p-6"
        />
      </div>
    </div>
  );
}

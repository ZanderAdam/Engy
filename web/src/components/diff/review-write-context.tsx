'use client';

import { createContext, useContext } from 'react';

export interface ReviewWriteActions {
  addDraft: (
    filePath: string,
    lineNumber: number,
    side: 'modified' | 'original',
    text: string,
    codeLine: string,
  ) => Promise<void>;
}

const ReviewWriteContext = createContext<ReviewWriteActions | null>(null);

export const ReviewWriteProvider = ReviewWriteContext.Provider;

export function useReviewWrite(): ReviewWriteActions | null {
  return useContext(ReviewWriteContext);
}

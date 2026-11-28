'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface MentionConfig {
  documentId: string;
  /** Read through a getter so a silent token refresh does not rebuild the menu. */
  getAccessToken: () => string | null;
  /** False for guests and anyone without comment access. */
  enabled: boolean;
}

const MentionConfigContext = createContext<MentionConfig | null>(null);

export function MentionConfigProvider({
  value,
  children,
}: {
  value: MentionConfig;
  children: ReactNode;
}) {
  return <MentionConfigContext.Provider value={value}>{children}</MentionConfigContext.Provider>;
}

export function useMentionConfig(): MentionConfig | null {
  return useContext(MentionConfigContext);
}

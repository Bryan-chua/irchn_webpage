'use client';

import { createContext, useContext, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';

const ParticipantPopupContext = createContext<{
  guideIsBlocking: boolean;
  setGuideIsBlocking: Dispatch<SetStateAction<boolean>>;
} | null>(null);

export default function ParticipantPopupProvider({ children }: { children: ReactNode }) {
  // Block announcements on the homepage until the guide checks its first-visit state.
  const [guideIsBlocking, setGuideIsBlocking] = useState(true);
  const value = useMemo(() => ({ guideIsBlocking, setGuideIsBlocking }), [guideIsBlocking]);
  return <ParticipantPopupContext.Provider value={value}>{children}</ParticipantPopupContext.Provider>;
}

export function useParticipantPopups() {
  const context = useContext(ParticipantPopupContext);
  if (!context) throw new Error('Participant popups require ParticipantPopupProvider.');
  return context;
}

import { createContext, type JSX, useContext } from "solid-js";
import { createNotices, type Notices } from "./createNotices.js";
import { NoticeRegion } from "./NoticeRegion.js";

const NoticesContext = createContext<Notices>();

export interface NoticeProviderProps {
  autoHideMs?: number;
  children: JSX.Element;
}

/** Provides notice state to the app and shows its notices at the top centre. */
export function NoticeProvider(props: NoticeProviderProps) {
  const notices = createNotices({ autoHideMs: props.autoHideMs });
  return (
    <NoticesContext.Provider value={notices}>
      {props.children}
      <NoticeRegion notices={notices} />
    </NoticesContext.Provider>
  );
}

export function useNotices(): Notices {
  const notices = useContext(NoticesContext);
  if (!notices) {
    throw new Error("useNotices must be used inside NoticeProvider");
  }
  return notices;
}

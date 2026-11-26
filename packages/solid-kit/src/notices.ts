export {
  type CreateNoticesOptions,
  createNotices,
  DEFAULT_NOTICE_AUTO_HIDE_MS,
  errorDetail,
  type Notice,
  type NoticeAttemptOptions,
  type NoticeContent,
  type NoticeReport,
  type NoticeSeverity,
  type Notices,
} from "./notices/createNotices.js";
export {
  NoticeProvider,
  type NoticeProviderProps,
  useNotices,
} from "./notices/NoticeProvider.js";
export {
  NOTICE_MAX_VISIBLE,
  NoticeRegion,
} from "./notices/NoticeRegion.js";

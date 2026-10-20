import type {
  OperationAdmissionClosed,
  SessionTransitionInProgress,
} from "../operations/errors";
import type { SessionProcessesStopFailed } from "../processes/errors";
import type {
  AuthenticateUserFailure,
  UserRecordReadFailure,
} from "../user/errors";

export type SessionTransitionFailure =
  | OperationAdmissionClosed
  | SessionTransitionInProgress
  | SessionProcessesStopFailed;
export type LoginFailure = SessionTransitionFailure | AuthenticateUserFailure;
export type InitializeSessionFailure =
  | SessionTransitionFailure
  | UserRecordReadFailure;

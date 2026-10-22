import type { SessionProcessesStopFailed } from "../../applications/processes/errors";
import type {
  OperationAdmissionClosed,
  SessionTransitionInProgress,
} from "../../core/operations/errors";
import type {
  AuthenticateUserFailure,
  UserRecordReadFailure,
} from "../../core/user/errors";

export type SessionTransitionFailure =
  | OperationAdmissionClosed
  | SessionTransitionInProgress
  | SessionProcessesStopFailed;
export type LoginFailure = SessionTransitionFailure | AuthenticateUserFailure;
export type InitializeSessionFailure =
  | SessionTransitionFailure
  | UserRecordReadFailure;

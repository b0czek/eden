import type { CommandCompletion, CommandName } from "./commands";

export type CommunicationMode = "result" | "operation";

export interface OperationHandle<C extends string = string> {
  command: C;
  id: string;
}

export interface ResultCommand<A, R> {
  mode: "result";
  args: A;
  response: R;
}

export interface OperationCommand<A, R, C extends string = string> {
  mode: "operation";
  args: A;
  response: OperationHandle<C>;
  completion: R;
}

/** Request cancellation; observe the operation until cleanup completes. */
export interface OperationCancellation {
  cancel(handle: OperationHandle): Promise<void>;
}

export interface OperationSubmission {
  requestKey?: string;
}

/** Select one operation when subscribing to operation/changed. */
export interface OperationObservation {
  handle: OperationHandle;
  terminalOnly?: boolean;
}

export interface OperationProgress {
  completed: number;
  total?: number;
  unit: string;
}

export interface OperationError {
  name: string;
  message: string;
}

interface OperationSnapshotBase<C extends string> extends OperationHandle<C> {
  cancellable: boolean;
  revision: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  phase?: string;
  progress?: OperationProgress;
}

export type OperationSnapshot<C extends string = string, R = unknown> =
  | (OperationSnapshotBase<C> & { status: "queued" | "running" })
  | (OperationSnapshotBase<C> & {
      status: "cancelled";
      completedAt: number;
    })
  | (OperationSnapshotBase<C> & {
      status: "succeeded";
      completedAt: number;
      result: R;
    })
  | (OperationSnapshotBase<C> & {
      status: "failed";
      completedAt: number;
      error: OperationError;
      response?: R;
    });

/** Known commands retain their completion type; discovered handles remain inspectable. */
export type OperationCompletion<C extends string> = C extends CommandName
  ? CommandCompletion<C>
  : unknown;

/** App-side operation controls. Persist or send only its serializable handle. */
export interface Operation<C extends string = string> {
  readonly handle: OperationHandle<C>;
  get(): Promise<OperationSnapshot<C, OperationCompletion<C>>>;
  watch(
    listener: (snapshot: OperationSnapshot<C, OperationCompletion<C>>) => void,
  ): Promise<() => void>;
  /** Await completion and return the command's typed result. */
  result(): Promise<OperationCompletion<C>>;
  /** Request cancellation, then await result() for cleanup to finish. */
  cancel(): Promise<void>;
}

export interface OperationsAPI extends OperationCancellation {
  /** Restore app-side controls for a retained or shared handle. */
  from<C extends string>(handle: OperationHandle<C>): Operation<C>;
  get<C extends string>(
    handle: OperationHandle<C>,
  ): Promise<OperationSnapshot<C, OperationCompletion<C>>>;
  list(): Promise<OperationSnapshot[]>;
  watch<C extends string>(
    handle: OperationHandle<C>,
    listener: (snapshot: OperationSnapshot<C, OperationCompletion<C>>) => void,
  ): Promise<() => void>;
  wait<C extends string>(
    handle: OperationHandle<C>,
  ): Promise<OperationCompletion<C>>;
}

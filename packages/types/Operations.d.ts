import type { CommandCompletion, CommandName } from "./commands";

export type CommunicationMode = "immediate" | "operation" | "stream";

export interface OperationHandle<C extends string = string> {
  command: C;
  id: string;
}

export interface StreamHandle<C extends string = string> {
  command: C;
  id: string;
}

export interface ImmediateCommand<A, R> {
  mode: "immediate";
  args: A;
  response: R;
}

export interface OperationCommand<A, R, C extends string = string> {
  mode: "operation";
  args: A;
  response: OperationHandle<C>;
  completion: R;
}

export interface StreamCommand<A, Chunk, R, C extends string = string> {
  mode: "stream";
  args: A;
  response: StreamHandle<C>;
  chunk: Chunk;
  completion: R;
}

/** Reserved capability; this version provides no cancellation transport. */
export interface OperationCancellation {
  cancel(): Promise<void>;
}

export interface OperationSubmission {
  requestKey?: string;
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

export interface OperationsAPI {
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

import type { OperationHandle } from "@edenapp/types";

export interface EventScope {
  appId?: string;
  sessionId: string;
  operation?: { handle: OperationHandle; terminal: boolean };
}

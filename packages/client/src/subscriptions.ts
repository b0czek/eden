import type { EventData, EventName } from "@edenapp/types";
import { getEdenAPI } from "./runtime.js";

export async function subscribe<E extends EventName>(
  event: E,
  callback: (data: EventData<E>) => void,
): Promise<void> {
  return getEdenAPI().subscribe(event, callback);
}

export function unsubscribe<E extends EventName>(
  event: E,
  callback: (data: EventData<E>) => void,
): void {
  getEdenAPI().unsubscribe(event, callback);
}

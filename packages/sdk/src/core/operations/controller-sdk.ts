import * as v from "valibot";
import type { EdenOperationsObserver } from "../../api/control-plane";
import type { SdkContext } from "../../api/sdk-context";
import { operationHandleSchema } from "./schemas";
import type { Operations } from "./service";

export function createOperationsSdkController({
  operations,
  sdk,
}: {
  operations: Operations;
  sdk: SdkContext;
}): EdenOperationsObserver {
  return {
    get: (handle) =>
      sdk.run(() => operations.inspect(v.parse(operationHandleSchema, handle))),
    list: () => sdk.run(() => operations.inspectAll()),
    onChanged: (listener) =>
      sdk.subscribe(listener, (notify) =>
        operations.changed.on(({ payload: { snapshot } }) => notify(snapshot)),
      ),
  };
}

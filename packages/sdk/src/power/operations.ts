import { operationTask } from "../operations/OperationTask";
import type { PowerAction, PowerOperationBoundary } from "./ports";
import type { Power } from "./service";

export function createPowerOperations(
  power: Power,
  boundary: PowerOperationBoundary,
) {
  return {
    preparePower(args: { action: PowerAction }) {
      power.validatePower(args);
      return operationTask(
        (reporter) => boundary.run(power.power(args, reporter)),
        { transition: "runtime" },
      );
    },
  };
}

export type PowerOperations = ReturnType<typeof createPowerOperations>;

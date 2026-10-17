import * as Effect from "effect/Effect";
import * as v from "valibot";
import { command } from "../../src/controllers/controller";

command({ handle: () => 42 });
command({ handle: async () => "value" });
command({ handle: () => Effect.succeed(42) });
command({ handle: () => Effect.scoped(Effect.scope) });
command({ handle: async () => Effect.succeed(42) });
command({ handle: () => Effect.fail(new Error("expected")) });
command({
  input: v.object({ value: v.number() }),
  handle: ({ value }) => Effect.succeed(value),
});

// A command's execution environment cannot provide service or scope requirements.
// @ts-expect-error Scope has not been provided.
command({ handle: () => Effect.scope });
// @ts-expect-error Promises must not hide unmet Effect requirements.
command({ handle: async () => Effect.scope });
// @ts-expect-error Input validation does not provide an Effect scope.
command({ input: v.object({ value: v.number() }), handle: () => Effect.scope });
command({
  // @ts-expect-error Every possible result must be fully provided.
  handle: () => (Math.random() > 0.5 ? Effect.scope : Effect.succeed(1)),
});
// @ts-expect-error Promise results with schemas must also be fully provided.
command({ input: v.object({}), handle: async () => Effect.scope });

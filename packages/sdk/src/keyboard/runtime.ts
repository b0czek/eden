import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Views } from "../views/service";
import { createKeyboardAssets } from "./assets";
import { KeyboardAssets, KeyboardViews } from "./ports";
import { createKeyboardViews } from "./views";

export const KeyboardPortsLive = Layer.effectContext(
  Effect.gen(function* () {
    return Context.make(KeyboardAssets, createKeyboardAssets()).pipe(
      Context.add(KeyboardViews, createKeyboardViews(yield* Views)),
    );
  }),
);

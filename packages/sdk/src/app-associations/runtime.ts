import * as path from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { io } from "../filesystem/native-io";
import { IpcTransport } from "../ipc/transport";
import { UserDirectory } from "../runtime/inputs";
import { createAppAssociationsController } from "./controller-edenapi";
import { AppAssociationStorage } from "./ports";
import { AppAssociations } from "./service";

export const registerAppAssociationsApi = Effect.gen(function* () {
  (yield* IpcTransport).registerController(
    createAppAssociationsController(yield* AppAssociations),
  );
});
export const AppAssociationsPortsLive = Layer.effect(
  AppAssociationStorage,
  Effect.gen(function* () {
    const directory = yield* UserDirectory;
    const file = path.join(directory, "app-associations.json");
    return {
      read: () => io.readFile(file, "utf-8"),
      write: (content: string) =>
        Effect.andThen(io.mkdir(directory), io.writeFileAtomic(file, content)),
    };
  }),
);

import type {
  ConnectResult,
  RegisteredService,
  ServiceInfo,
} from "@edenapp/types";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { log } from "../../platform/logging/logger";
import type { PlatformMessagePort } from "../../platform/ports/types";
import { Backends } from "../processes/backends";
import { AppChannelFailure, AppServiceAlreadyRegistered } from "./errors";
import { AppChannelTransport } from "./ports";

interface Destination {
  appId: string;
  send(channel: string, message: object, ports?: PlatformMessagePort[]): void;
}

export interface AppChannels {
  registerService: (
    appId: string,
    serviceName: string,
    webContentsId: number,
    options?: { description?: string; allowedClients?: string[] },
  ) => Effect.Effect<void, AppServiceAlreadyRegistered>;
  unregisterService: (
    appId: string,
    serviceName: string,
  ) => Effect.Effect<boolean>;
  connect: (
    requesterAppId: string,
    requesterWebContentsId: number,
    targetAppId: string,
    serviceName: string,
  ) => Effect.Effect<ConnectResult, AppChannelFailure>;
  /** Synchronous teardown removes registrations before views and backends. */
  unregisterAllServices: (appId: string) => number;
  listServices: () => ServiceInfo[];
  getServicesByApp: (appId: string) => ServiceInfo[];
}

export const AppChannels = Context.Service<"eden/AppChannels", AppChannels>(
  "eden/AppChannels",
);

export const AppChannelsLive = Layer.effect(
  AppChannels,
  Effect.gen(function* () {
    const clock = yield* Clock.Clock;
    const channels = yield* AppChannelTransport;
    const backends = yield* Backends;
    let nextConnectionId = 0;
    const services = new Map<string, RegisteredService>();
    const connections = new Map<
      string,
      {
        requester: Destination;
        provider: Destination;
      }
    >();

    function destination(
      appId: string,
      webContents: ReturnType<AppChannelTransport["getWebContentsById"]>,
    ): Destination {
      return {
        appId,
        send: webContents
          ? (channel, message, ports) => {
              if (ports) webContents.postMessage(channel, message, ports);
              else if (!webContents.isDestroyed())
                webContents.send(channel, message);
            }
          : (type, message, ports) => {
              backends.sendMessage(appId, { type, ...message }, ports);
            },
      };
    }

    function serviceKey(appId: string, serviceName: string): string {
      return `${appId}:${serviceName}`;
    }

    function registerService(
      appId: string,
      serviceName: string,
      webContentsId: number,
      options?: { description?: string; allowedClients?: string[] },
    ) {
      return Effect.gen(function* () {
        const key = serviceKey(appId, serviceName);

        if (services.has(key)) {
          return yield* Effect.fail(
            new AppServiceAlreadyRegistered({ appId, serviceName }),
          );
        }
        const providerType =
          webContentsId && webContentsId > 0 ? "frontend" : "backend";

        const service: RegisteredService = {
          appId,
          serviceName,
          webContentsId:
            providerType === "frontend" ? webContentsId : undefined,
          providerType,
          description: options?.description,
          allowedClients: options?.allowedClients,
        };

        services.set(key, service);
        log.info(`Registered service "${serviceName}" from app "${appId}"`);
      });
    }

    function unregisterService(appId: string, serviceName: string) {
      return Effect.sync((): boolean => {
        const key = serviceKey(appId, serviceName);
        const deleted = services.delete(key);

        if (deleted) {
          log.info(`Unregistered service "${serviceName}" from app "${appId}"`);
        }

        return deleted;
      });
    }

    function unregisterAllServices(appId: string): number {
      let count = 0;
      for (const [key, service] of services) {
        if (service.appId === appId) {
          services.delete(key);
          count++;
        }
      }

      if (count > 0) {
        log.info(`Unregistered ${count} services from app "${appId}"`);
      }
      closeConnectionsForApp(appId);

      return count;
    }

    function getService(
      appId: string,
      serviceName: string,
    ): RegisteredService | undefined {
      return services.get(serviceKey(appId, serviceName));
    }

    function isClientAllowed(
      service: RegisteredService,
      clientAppId: string,
    ): boolean {
      if (!service.allowedClients || service.allowedClients.length === 0) {
        return true;
      }
      return service.allowedClients.includes(clientAppId);
    }

    function connect(
      requesterAppId: string,
      requesterWebContentsId: number,
      targetAppId: string,
      serviceName: string,
    ) {
      return Effect.gen(function* () {
        const native = <A>(
          operation: AppChannelFailure["operation"],
          work: () => A,
        ) =>
          Effect.try({
            try: work,
            catch: (cause) =>
              new AppChannelFailure({
                operation,
                requesterAppId,
                targetAppId,
                serviceName,
                cause,
              }),
          });
        const service = getService(targetAppId, serviceName);

        if (!service) {
          return {
            success: false as const,
            error: `Service "${serviceName}" not found on app "${targetAppId}"`,
          };
        }
        if (!isClientAllowed(service, requesterAppId)) {
          return {
            success: false as const,
            error: `App "${requesterAppId}" is not allowed to connect to service "${serviceName}"`,
          };
        }
        const requesterWebContents = requesterWebContentsId
          ? yield* native("lookup-requester", () =>
              channels.getWebContentsById(requesterWebContentsId),
            )
          : undefined;
        const providerWebContentsId = service.webContentsId;
        const targetWebContents = providerWebContentsId
          ? yield* native("lookup-provider", () =>
              channels.getWebContentsById(providerWebContentsId),
            )
          : undefined;
        const isRequesterBackend =
          !requesterWebContents && backends.hasBackend(requesterAppId);

        if (!requesterWebContents && !isRequesterBackend) {
          return {
            success: false as const,
            error: "Requester process not found",
          };
        }
        const isTargetBackend =
          service.providerType === "backend" &&
          backends.hasBackend(targetAppId);

        if (service.providerType === "frontend" && !targetWebContents) {
          return {
            success: false as const,
            error: `Target app "${targetAppId}" frontend is not running`,
          };
        }

        if (service.providerType === "backend" && !isTargetBackend) {
          return {
            success: false as const,
            error: `Target app "${targetAppId}" backend is not running`,
          };
        }
        const { port1, port2 } = yield* native("create-channel", () =>
          channels.createMessageChannel(),
        );
        const connectionId = `${requesterAppId}->${targetAppId}:${serviceName}:${clock.currentTimeMillisUnsafe()}:${++nextConnectionId}`;

        const requester = destination(requesterAppId, requesterWebContents);
        const provider = destination(targetAppId, targetWebContents);
        connections.set(connectionId, { requester, provider });

        log.info(
          `Creating channel: ${requesterAppId} -> ${targetAppId}:${serviceName}`,
        );
        yield* native("transfer-requester", () =>
          requester.send(
            "appbus-port",
            { connectionId, targetAppId, serviceName, role: "client" },
            [port1],
          ),
        );
        yield* native("transfer-provider", () =>
          provider.send(
            "appbus-port",
            {
              connectionId,
              sourceAppId: requesterAppId,
              serviceName,
              role: "service",
            },
            [port2],
          ),
        );

        return { success: true, connectionId } satisfies ConnectResult;
      });
    }

    function closeConnectionsForApp(appId: string): void {
      for (const [connectionId, { requester, provider }] of connections) {
        if (requester.appId !== appId && provider.appId !== appId) continue;
        connections.delete(connectionId);
        const peer = requester.appId === appId ? provider : requester;
        peer.send("appbus-port-closed", { connectionId });
        log.info(`Closed connection: ${connectionId}`);
      }
    }

    function listServices(): ServiceInfo[] {
      return Array.from(services.values()).map((service) => ({
        appId: service.appId,
        serviceName: service.serviceName,
        description: service.description,
      }));
    }

    function getServicesByApp(appId: string): ServiceInfo[] {
      return listServices().filter((s) => s.appId === appId);
    }

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        connections.clear();
        services.clear();
        log.info("Destroyed");
      }),
    );

    return {
      registerService,
      unregisterService,
      connect,
      unregisterAllServices,
      listServices,
      getServicesByApp,
    };
  }),
);

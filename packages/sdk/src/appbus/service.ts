import type {
  ConnectResult,
  RegisteredService,
  ServiceInfo,
} from "@edenapp/types";
import * as Effect from "effect/Effect";
import { log } from "../logging";
import type { AppChannelBackends, AppChannelTransport } from "./ports";

const attempt = <A>(work: () => A) =>
  Effect.try({
    try: work,
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });

export function createAppChannels({
  channels,
  backends,
}: {
  channels: AppChannelTransport;
  backends: AppChannelBackends;
}) {
  return Effect.gen(function* () {
    const services = new Map<string, RegisteredService>();
    const connections = new Map<
      string,
      {
        requesterAppId: string;
        requesterWebContentsId?: number;
        targetAppId: string;
        targetWebContentsId?: number;
      }
    >();
    function serviceKey(appId: string, serviceName: string): string {
      return `${appId}:${serviceName}`;
    }

    function registerService(
      appId: string,
      serviceName: string,
      webContentsId: number,
      options?: { description?: string; allowedClients?: string[] },
    ) {
      return attempt((): void => {
        const key = serviceKey(appId, serviceName);

        if (services.has(key)) {
          throw new Error(
            `Service "${serviceName}" is already registered by app "${appId}"`,
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
      return attempt((): boolean => {
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
      return attempt((): ConnectResult => {
        const service = getService(targetAppId, serviceName);

        if (!service) {
          return {
            success: false,
            error: `Service "${serviceName}" not found on app "${targetAppId}"`,
          };
        }
        if (!isClientAllowed(service, requesterAppId)) {
          return {
            success: false,
            error: `App "${requesterAppId}" is not allowed to connect to service "${serviceName}"`,
          };
        }
        const requesterWebContents = requesterWebContentsId
          ? channels.getWebContentsById(requesterWebContentsId)
          : undefined;
        const targetWebContents = service.webContentsId
          ? channels.getWebContentsById(service.webContentsId)
          : undefined;
        const isRequesterBackend =
          !requesterWebContents && backends.hasBackend(requesterAppId);

        if (!requesterWebContents && !isRequesterBackend) {
          return { success: false, error: "Requester process not found" };
        }
        const isTargetBackend =
          service.providerType === "backend" &&
          backends.hasBackend(targetAppId);

        if (service.providerType === "frontend" && !targetWebContents) {
          return {
            success: false,
            error: `Target app "${targetAppId}" frontend is not running`,
          };
        }

        if (service.providerType === "backend" && !isTargetBackend) {
          return {
            success: false,
            error: `Target app "${targetAppId}" backend is not running`,
          };
        }
        const { port1, port2 } = channels.createMessageChannel();
        const connectionId = `${requesterAppId}->${targetAppId}:${serviceName}:${Date.now()}`;

        connections.set(connectionId, {
          requesterAppId,
          requesterWebContentsId: requesterWebContentsId || undefined,
          targetAppId,
          targetWebContentsId: service.webContentsId,
        });

        log.info(
          `Creating channel: ${requesterAppId} -> ${targetAppId}:${serviceName}`,
        );
        if (requesterWebContents) {
          requesterWebContents.postMessage(
            "appbus-port",
            {
              connectionId,
              targetAppId,
              serviceName,
              role: "client",
            },
            [port1],
          );
        } else {
          backends.sendPortToBackend(
            requesterAppId,
            {
              type: "appbus-port",
              connectionId,
              targetAppId,
              serviceName,
              role: "client",
            },
            [port1],
          );
        }
        if (targetWebContents) {
          targetWebContents.postMessage(
            "appbus-port",
            {
              connectionId,
              sourceAppId: requesterAppId,
              serviceName,
              role: "service",
            },
            [port2],
          );
        } else {
          backends.sendPortToBackend(
            targetAppId,
            {
              type: "appbus-port",
              connectionId,
              sourceAppId: requesterAppId,
              serviceName,
              role: "service",
            },
            [port2],
          );
        }

        return { success: true, connectionId };
      });
    }

    function closeConnection(connectionId: string): boolean {
      const connection = connections.get(connectionId);
      if (!connection) {
        return false;
      }

      connections.delete(connectionId);
      log.info(`Closed connection: ${connectionId}`);
      return true;
    }

    function closeConnectionsForApp(appId: string): void {
      const connectionsToClose: string[] = [];

      for (const [connectionId, conn] of connections) {
        if (conn.requesterAppId === appId || conn.targetAppId === appId) {
          connectionsToClose.push(connectionId);
          if (conn.requesterAppId === appId) {
            notifyPortClosed(
              conn.targetAppId,
              conn.targetWebContentsId,
              connectionId,
            );
          } else {
            notifyPortClosed(
              conn.requesterAppId,
              conn.requesterWebContentsId,
              connectionId,
            );
          }
        }
      }

      for (const connectionId of connectionsToClose) {
        closeConnection(connectionId);
      }
    }

    function notifyPortClosed(
      appId: string,
      webContentsId: number | undefined,
      connectionId: string,
    ): void {
      log.info(
        `Notifying port closed for app "${appId}" (webContentsId: ${webContentsId})`,
      );
      if (webContentsId) {
        const wc = channels.getWebContentsById(webContentsId);
        if (wc && !wc.isDestroyed()) {
          wc.send("appbus-port-closed", { connectionId });
        }
      } else {
        backends.sendMessage(appId, {
          type: "appbus-port-closed",
          connectionId,
        });
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
        for (const connectionId of connections.keys())
          closeConnection(connectionId);
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
  });
}

export type AppChannels = Effect.Success<ReturnType<typeof createAppChannels>>;

import type {
  AppManifest,
  AppProcessMetrics,
  EdenProcessMetric,
  ProcessMetricsSnapshot,
} from "@edenapp/types";
import { locale, t } from "../i18n";
import type { ProcessMetricsState, TrackedProcessMetric } from "./types";

export const getLocalizedManifestName = (
  manifestName: AppManifest["name"] | undefined,
): string => {
  if (!manifestName) return t("taskManager.labels.unknownApp");
  if (typeof manifestName === "string") return manifestName;

  const currentLocale = locale();
  return (
    manifestName[currentLocale] ??
    manifestName.en ??
    Object.values(manifestName)[0] ??
    t("taskManager.labels.unknownApp")
  );
};

export const formatCpuUsage = (value: number): string => {
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)}%`;
};

export const formatMemoryUsage = (valueInKb: number): string => {
  const valueInMb = valueInKb / 1024;
  if (valueInMb >= 1024) {
    return `${(valueInMb / 1024).toFixed(1)} GB`;
  }

  const digits = valueInMb >= 100 ? 0 : 1;
  return `${valueInMb.toFixed(digits)} MB`;
};

export const getProcessDisplayName = (process: EdenProcessMetric): string =>
  process.name ||
  process.serviceName ||
  process.processType ||
  t("taskManager.labels.unnamedProcess");

export const getProcessRoleLabel = (process: EdenProcessMetric): string => {
  switch (process.category) {
    case "renderer":
      return t("taskManager.labels.renderer");
    case "backend":
      return t("taskManager.labels.backend");
    default:
      return t("taskManager.labels.shared");
  }
};

export const getProcessTypeLabel = (process: EdenProcessMetric): string =>
  `${getProcessRoleLabel(process)} / ${process.processType}`;

export const getChildProcesses = (
  appMetrics: Pick<AppProcessMetrics, "renderer" | "backend">,
): EdenProcessMetric[] =>
  [appMetrics.renderer, appMetrics.backend].filter(
    (process): process is EdenProcessMetric => Boolean(process),
  );

export const getAppGroupKey = (
  appMetrics: Pick<AppProcessMetrics, "instance">,
): string => appMetrics.instance.instanceId;

export const getProcessKey = (process: EdenProcessMetric): string =>
  `${process.pid}:${process.creationTime}`;

export const normalizeProcess = (
  process: EdenProcessMetric,
): TrackedProcessMetric => ({
  ...process,
  id: getProcessKey(process),
});

export const normalizeSnapshot = (
  snapshot: ProcessMetricsSnapshot,
): ProcessMetricsState => ({
  ...snapshot,
  apps: snapshot.apps.map((appMetrics) => ({
    ...appMetrics,
    id: getAppGroupKey(appMetrics),
    renderer: appMetrics.renderer
      ? normalizeProcess(appMetrics.renderer)
      : undefined,
    backend: appMetrics.backend
      ? normalizeProcess(appMetrics.backend)
      : undefined,
  })),
  sharedProcesses: snapshot.sharedProcesses.map(normalizeProcess),
});

export const getAppSubtitle = (
  appMetrics: AppProcessMetrics,
  children: EdenProcessMetric[],
): string => {
  const manifestId = appMetrics.instance.manifest.id;
  if (children.length > 1) {
    return `${t("taskManager.labels.processCount", {
      count: children.length,
    })} · ${manifestId}`;
  }

  const singleProcess = children[0];
  if (!singleProcess) return manifestId;

  return `${getProcessTypeLabel(singleProcess)} · ${manifestId}`;
};

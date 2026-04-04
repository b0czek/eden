export const en = {
  taskManager: {
    staleData: "Showing the last successful sample",
    sections: {
      apps: "Apps",
      system: "System Processes",
    },
    columns: {
      name: "Name",
      pid: "PID",
      cpu: "CPU",
      memory: "Memory",
    },
    labels: {
      processCount: "{count} processes",
      renderer: "Renderer",
      backend: "Backend",
      shared: "Shared",
      groupedPid: "Group",
      unknownApp: "Unknown App",
      unnamedProcess: "Unnamed process",
      appsSectionHint: "User programs",
      systemSectionHint: "Shared Electron and Eden services",
      noApps: "No user applications are running",
      noSystemProcesses: "No shared system processes are active",
      sampleFailed: "Failed to load process metrics",
    },
  },
} as const;

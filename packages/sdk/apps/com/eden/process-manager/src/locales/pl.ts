export const pl = {
  taskManager: {
    staleData: "Pokazywana jest ostatnia poprawna próbka",
    sections: {
      apps: "Aplikacje",
      system: "Procesy systemowe",
    },
    columns: {
      name: "Nazwa",
      pid: "PID",
      cpu: "CPU",
      memory: "Pamięć",
    },
    labels: {
      processCount: "{count} procesy",
      renderer: "Renderer",
      backend: "Backend",
      shared: "Wspólny",
      groupedPid: "Grupa",
      unknownApp: "Nieznana aplikacja",
      unnamedProcess: "Proces bez nazwy",
      appsSectionHint: "Programy użytkownika",
      systemSectionHint: "Wspólne usługi Electron i Eden",
      noApps: "Brak uruchomionych aplikacji użytkownika",
      noSystemProcesses: "Brak aktywnych wspólnych procesów systemowych",
      sampleFailed: "Nie udało się pobrać metryk procesów",
    },
  },
} as const;

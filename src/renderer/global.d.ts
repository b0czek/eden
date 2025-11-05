// Ambient declarations for renderer globals

interface EdenAPI {
  getSystemInfo: () => Promise<any>;
  shellCommand: (command: string, args: any) => Promise<any>;
  onSystemMessage: (callback: (message: any) => void) => void;
  launchApp: (appId: string, bounds?: any) => Promise<any>;
  stopApp: (appId: string) => Promise<any>;
  installApp: (sourcePath: string) => Promise<any>;
  uninstallApp: (appId: string) => Promise<any>;
  selectDirectory: () => Promise<string | null>;
}

interface Window {
  edenAPI: EdenAPI;
}

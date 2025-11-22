import { CommandName, CommandArgs, CommandResult } from '../types/commands';

declare global {
  interface Window {
    // App communication API (set by app-preload.ts)
    appAPI?: {
      getAppId: () => string | null;
      onBoundsUpdated: (callback: (bounds: any) => void) => void;
      sendMessage: (message: any) => void;
      sendRequest: (message: any) => Promise<any>;
      onMessage: (callback: (message: any) => void) => void;
    };
    
    // Shell command API (set by app-preload.ts)
    edenAPI?: {
      shellCommand: <T extends CommandName>(command: T, args: CommandArgs<T>) => Promise<CommandResult<T>>;
    };
    
    // Eden Frame API and internal state (set by frame-injector.ts)
    edenFrame?: {
      // Public API
      setTitle: (title: string) => void;
      
      // Internal state (used by frame system)
      _internal: {
        injected: boolean;
        config: {
          mode?: 'tiled' | 'floating' | 'both';
          showTitle?: boolean;
          defaultSize?: { width: number; height: number };
          defaultPosition?: { x: number; y: number };
          movable?: boolean;
          resizable?: boolean;
          minSize?: { width: number; height: number };
          maxSize?: { width: number; height: number };
        };
        currentMode: 'tiled' | 'floating';
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
      };
    };
  }
}

import { Plugin } from 'vite';
import { generateCommands } from './generate-commands';

export default function commandGenerator(): Plugin {
  return {
    name: 'eden-command-generator',
    buildStart() {
      generateCommands();
    },
    handleHotUpdate({ file }) {
      // Regenerate commands when main process files change
      if (file.includes('/src/main/') && file.endsWith('.ts')) {
        console.log('🔄 Main process file changed, regenerating commands...');
        generateCommands();
      }
    }
  };
}

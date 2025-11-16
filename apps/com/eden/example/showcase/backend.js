// Design Showcase App Backend
// This runs in a worker thread

const { parentPort, workerData } = require('worker_threads');

console.log('Design Showcase backend starting...');
console.log('App ID:', workerData.appId);
console.log('Install path:', workerData.installPath);

// Listen for messages from the main process or frontend
if (parentPort) {
  parentPort.on('message', (message) => {
    console.log('Showcase backend received message:', message);
    
    // Handle different message types
    switch (message.type) {
      case 'get-component-info':
        // Example: could provide metadata about components
        parentPort.postMessage({
          type: 'component-info-response',
          source: workerData.appId,
          target: message.source,
          payload: {
            componentCount: 8,
            categories: ['buttons', 'inputs', 'cards', 'modals', 'badges', 'progress', 'lists', 'tabs'],
            version: '1.0.0'
          },
          messageId: generateId(),
          timestamp: Date.now(),
        });
        break;
        
      case 'export-showcase-data':
        // Example: could export component data
        console.log('Exporting showcase data...');
        break;
        
      default:
        console.log('Unknown message type:', message.type);
    }
  });

  // Send a startup message
  parentPort.postMessage({
    type: 'backend-ready',
    source: workerData.appId,
    target: 'system',
    payload: {
      message: 'Design Showcase backend is ready!',
      features: ['component-info', 'export-showcase-data']
    },
    messageId: generateId(),
    timestamp: Date.now(),
  });
}

// Helper to generate unique IDs
function generateId() {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Handle errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception in showcase backend:', error);
  if (parentPort) {
    parentPort.postMessage({
      type: 'error',
      source: workerData.appId,
      target: 'system',
      payload: {
        error: error.message,
        stack: error.stack,
      },
      messageId: generateId(),
      timestamp: Date.now(),
    });
  }
});

// Periodic heartbeat (optional - keeps backend active)
setInterval(() => {
  if (parentPort) {
    parentPort.postMessage({
      type: 'heartbeat',
      source: workerData.appId,
      target: 'system',
      payload: {
        status: 'alive',
        uptime: process.uptime()
      },
      messageId: generateId(),
      timestamp: Date.now(),
    });
  }
}, 30000); // Every 30 seconds

console.log('Design Showcase backend initialized and listening for events');


// Calculator App Backend
// This runs in a worker thread

const { parentPort, workerData } = require('worker_threads');

console.log('Calculator app backend starting...');
console.log('App ID:', workerData.appId);
console.log('Install path:', workerData.installPath);

// Listen for messages from the main process or frontend
if (parentPort) {
  parentPort.on('message', (message) => {
    console.log('Backend received message:', message);
    
    // Handle different message types here
  });

  // Send a startup message
  parentPort.postMessage({
    type: 'backend-ready',
    source: workerData.appId,
    target: 'system',
    payload: {
      message: 'Calculator backend is ready!',
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
  console.error('Uncaught exception in backend:', error);
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

console.log('Calculator backend initialized');

// Example App Backend
// This runs in a worker thread and can handle app logic, data processing, etc.

const { parentPort, workerData } = require('worker_threads');

console.log('Hello World app backend starting...');
console.log('App ID:', workerData.appId);
console.log('Install path:', workerData.installPath);

// State
let messageCount = 0;

// Listen for messages from the main process or frontend
if (parentPort) {
  parentPort.on('message', (message) => {
    console.log('Backend received message:', message);

    // Handle different message types
    switch (message.type) {
      case 'ping':
        // Respond to ping
        parentPort.postMessage({
          type: 'pong',
          source: workerData.appId,
          target: message.source,
          payload: {
            timestamp: Date.now(),
            messageCount: ++messageCount,
          },
          messageId: generateId(),
          replyTo: message.messageId,
          timestamp: Date.now(),
        });
        break;

      case 'get-status':
        // Send status information
        parentPort.postMessage({
          type: 'status',
          source: workerData.appId,
          target: message.source,
          payload: {
            status: 'running',
            uptime: process.uptime(),
            messageCount,
          },
          messageId: generateId(),
          replyTo: message.messageId,
          timestamp: Date.now(),
        });
        break;

      case 'hello':
        // Echo back with a greeting
        parentPort.postMessage({
          type: 'greeting',
          source: workerData.appId,
          target: message.source,
          payload: {
            message: `Hello from backend! You said: ${message.payload.message}`,
          },
          messageId: generateId(),
          replyTo: message.messageId,
          timestamp: Date.now(),
        });
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
      message: 'Hello World backend is ready!',
    },
    messageId: generateId(),
    timestamp: Date.now(),
  });

  // Periodic heartbeat
  setInterval(() => {
    if (parentPort) {
      parentPort.postMessage({
        type: 'heartbeat',
        source: workerData.appId,
        target: 'system',
        payload: {
          timestamp: Date.now(),
          messageCount,
        },
        messageId: generateId(),
        timestamp: Date.now(),
      });
    }
  }, 10000); // Every 10 seconds
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

console.log('Hello World backend initialized');

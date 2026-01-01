// Example App Backend
// This runs in a utility process and uses the global worker API
// worker.getAppAPI() returns the connection immediately (ready by the time this runs)

const appId = process.env.EDEN_APP_ID;
console.log(`Hello World backend starting for ${appId}`);
console.log('Install path:', process.env.EDEN_INSTALL_PATH);

// State
let messageCount = 0;

// Get the appAPI connection
const appAPI = worker.getAppAPI();

// Register request handlers for frontend requests
appAPI.handle('ping', (payload) => {
  messageCount++;
  return {
    timestamp: Date.now(),
    messageCount,
  };
});

appAPI.handle('get-status', (payload) => {
  return {
    status: 'running',
    uptime: process.uptime(),
    messageCount,
  };
});

appAPI.handle('hello', (payload) => {
  return {
    message: `Hello from backend! You said: ${payload.message}`,
  };
});

// Send a startup message (fire-and-forget)
appAPI.send('backend-ready', {
  message: 'Hello World backend is ready!',
});

// Periodic heartbeat
setInterval(() => {
  appAPI.send('heartbeat', {
    timestamp: Date.now(),
    messageCount,
  });
}, 10000); // Every 10 seconds

console.log('Hello World backend initialized');

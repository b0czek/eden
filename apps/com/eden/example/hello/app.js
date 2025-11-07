// Example App Frontend Logic

class HelloApp {
  constructor() {
    this.statusDiv = document.getElementById('status');
    this.setupEventListeners();
    this.setupMessageListener();
    this.log('App initialized');
  }

  setupEventListeners() {
    document.getElementById('ping-btn').addEventListener('click', () => {
      this.pingBackend();
    });

    document.getElementById('status-btn').addEventListener('click', () => {
      this.getBackendStatus();
    });

    document.getElementById('hello-btn').addEventListener('click', () => {
      this.sayHello();
    });
  }

  setupMessageListener() {
    if (window.appAPI) {
      window.appAPI.onMessage((message) => {
        this.handleMessage(message);
      });
    }
  }

  async pingBackend() {
    this.log('Sending ping to backend...');
    
    try {
      const message = {
        type: 'ping',
        source: 'frontend',
        target: 'backend',
        payload: {},
        messageId: this.generateId(),
        timestamp: Date.now(),
      };

      if (window.appAPI) {
        const response = await window.appAPI.sendRequest(message);
        this.log(`Pong received! Message count: ${response.messageCount}`);
      } else {
        this.log('Error: appAPI not available');
      }
    } catch (error) {
      this.log(`Error: ${error.message}`);
    }
  }

  async getBackendStatus() {
    this.log('Requesting backend status...');
    
    try {
      const message = {
        type: 'get-status',
        source: 'frontend',
        target: 'backend',
        payload: {},
        messageId: this.generateId(),
        timestamp: Date.now(),
      };

      if (window.appAPI) {
        const response = await window.appAPI.sendRequest(message);
        this.log(`Status: ${response.status}`);
        this.log(`Uptime: ${response.uptime.toFixed(2)}s`);
        this.log(`Messages: ${response.messageCount}`);
      } else {
        this.log('Error: appAPI not available');
      }
    } catch (error) {
      this.log(`Error: ${error.message}`);
    }
  }

  async sayHello() {
    const userMessage = prompt('What would you like to say?', 'Hello from frontend!');
    if (!userMessage) return;

    this.log(`Sending: "${userMessage}"`);
    
    try {
      const message = {
        type: 'hello',
        source: 'frontend',
        target: 'backend',
        payload: {
          message: userMessage,
        },
        messageId: this.generateId(),
        timestamp: Date.now(),
      };

      if (window.appAPI) {
        const response = await window.appAPI.sendRequest(message);
        this.log(`Backend says: ${response.message}`);
      } else {
        this.log('Error: appAPI not available');
      }
    } catch (error) {
      this.log(`Error: ${error.message}`);
    }
  }

  handleMessage(message) {
    console.log('Received message:', message);

    switch (message.type) {
      case 'backend-ready':
        this.log('✓ Backend is ready!');
        break;
      case 'heartbeat':
        // Silent - just log to console
        console.log('Heartbeat from backend');
        break;
      default:
        this.log(`Message: ${message.type}`);
    }
  }

  log(text) {
    const p = document.createElement('p');
    p.textContent = `[${new Date().toLocaleTimeString()}] ${text}`;
    
    if (this.statusDiv) {
      this.statusDiv.appendChild(p);
      this.statusDiv.scrollTop = this.statusDiv.scrollHeight;
      
      // Keep only last 20 messages
      while (this.statusDiv.children.length > 20) {
        this.statusDiv.removeChild(this.statusDiv.firstChild);
      }
    }
  }

  generateId() {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new HelloApp());
} else {
  new HelloApp();
}

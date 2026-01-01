// AppBus Client A
// Connects to Hub for mediated chat + exposes direct-chat service for Isolated app

const CLIENT_ID = 'com.eden.example.appbus.client-a';
const NICKNAME = 'Client A';

class ClientAApp {
  constructor() {
    this.hubConnection = null;
    this.directConnections = new Map(); // Track direct connections from Isolated
    
    // DOM elements
    this.hubStatus = document.getElementById('hub-status');
    this.hubClientsCount = document.getElementById('hub-clients-count');
    this.hubChat = document.getElementById('hub-chat');
    this.hubMessage = document.getElementById('hub-message');
    this.hubSendBtn = document.getElementById('hub-send-btn');
    
    this.directStatus = document.getElementById('direct-status');
    this.directChat = document.getElementById('direct-chat');
    this.directMessage = document.getElementById('direct-message');
    this.directSendBtn = document.getElementById('direct-send-btn');
    
    this.setupEventListeners();
    this.connectToHub();
    this.exposeDirectChatService();
  }

  setupEventListeners() {
    // Hub chat
    this.hubSendBtn.addEventListener('click', () => this.sendHubMessage());
    this.hubMessage.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendHubMessage();
    });

    // Direct chat
    this.directSendBtn.addEventListener('click', () => this.sendDirectMessage());
    this.directMessage.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendDirectMessage();
    });
  }

  // === HUB CONNECTION ===
  
  async connectToHub() {
    this.addHubMessage('Connecting to Hub...', 'system');
    
    try {
      const result = await window.appBus.connect(
        'com.eden.example.appbus.hub',
        'chat-relay'
      );

      if ('error' in result) {
        this.addHubMessage(`Failed: ${result.error}`, 'system');
        return;
      }

      this.hubConnection = result;
      this.hubStatus.textContent = 'Connected';
      this.hubStatus.className = 'eden-badge eden-badge-success';

      // Handle hub disconnect
      this.hubConnection.onClose(() => {
        this.addHubMessage('Hub connection closed', 'system');
        this.hubStatus.textContent = 'Disconnected';
        this.hubStatus.className = 'eden-badge eden-badge-danger';
        this.hubConnection = null;
      });

      // Listen for incoming messages from Hub
      this.hubConnection.on('chat-message', (data) => {
        const isOwn = data.from === CLIENT_ID;
        this.addHubMessage(`${data.nickname}: ${data.message}`, isOwn ? 'own' : 'other');
      });

      this.hubConnection.on('client-joined', (data) => {
        this.addHubMessage(`${data.nickname} joined the chat`, 'system');
        this.updateClientCount();
      });

      this.hubConnection.on('client-left', (data) => {
        this.addHubMessage(`${data.nickname} left the chat`, 'system');
        this.updateClientCount();
      });

      // Join the chat
      const joinResult = await this.hubConnection.request('join', {
        clientId: CLIENT_ID,
        nickname: NICKNAME
      });

      if (joinResult.success) {
        this.addHubMessage('Joined hub chat!', 'system');
        this.hubClientsCount.textContent = joinResult.clients.length;
      }

    } catch (err) {
      this.addHubMessage(`Error: ${err.message}`, 'system');
    }
  }

  async sendHubMessage() {
    const text = this.hubMessage.value.trim();
    if (!text || !this.hubConnection) return;

    this.hubMessage.value = '';

    try {
      await this.hubConnection.request('send-message', {
        clientId: CLIENT_ID,
        message: text
      });
    } catch (err) {
      this.addHubMessage(`Send failed: ${err.message}`, 'system');
    }
  }

  async updateClientCount() {
    if (!this.hubConnection) return;
    try {
      const result = await this.hubConnection.request('list-clients', {});
      this.hubClientsCount.textContent = result.clients.length;
    } catch (err) {
      console.error('Failed to get client count:', err);
    }
  }

  addHubMessage(text, type = 'other') {
    const div = document.createElement('div');
    div.className = `chat-message ${type}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<span class="time">${time}</span>${text}`;
    
    this.hubChat.appendChild(div);
    this.hubChat.scrollTop = this.hubChat.scrollHeight;
  }

  // === DIRECT CHAT SERVICE ===
  
  async exposeDirectChatService() {
    this.addDirectMessage('Exposing direct-chat service...', 'system');
    
    try {
      // New API: onConnect callback receives a connection for each client
      const result = await window.appBus.exposeService(
        'direct-chat',
        (connection, { appId }) => {
          console.log(`[Client A] Isolated app connected: ${appId}`);
          
          // Store the connection
          this.directConnections.set(appId, connection);
          this.addDirectMessage(`${appId} connected!`, 'system');
          
          this.directStatus.textContent = 'Connected';
          this.directStatus.className = 'eden-badge eden-badge-success';
          
          // Handle connection close
          connection.onClose(() => {
            this.addDirectMessage(`${appId} disconnected`, 'system');
            this.directConnections.delete(appId);
            if (this.directConnections.size === 0) {
              this.directStatus.textContent = 'Waiting';
              this.directStatus.className = 'eden-badge eden-badge-info';
            }
          });

          // Handle incoming messages from Isolated
          connection.on('message', (data) => {
            this.addDirectMessage(`Isolated: ${data.text}`, 'other');
          });
          
          // Handle requests from Isolated
          connection.handle('ping', () => {
            return { pong: true, from: NICKNAME };
          });
          
          // Send welcome message
          connection.send('message', { text: `Welcome! You're connected to ${NICKNAME}` });
        },
        {
          description: 'Direct chat service for Isolated app'
        }
      );

      if (result.success) {
        this.directStatus.textContent = 'Waiting';
        this.directStatus.className = 'eden-badge eden-badge-info';
        this.addDirectMessage('Ready for Isolated app connection', 'system');
      } else {
        this.addDirectMessage(`Failed to expose: ${result.error}`, 'system');
      }
    } catch (err) {
      this.addDirectMessage(`Error: ${err.message}`, 'system');
    }
  }

  sendDirectMessage() {
    const text = this.directMessage.value.trim();
    if (!text) return;

    this.directMessage.value = '';
    
    // Send to all connected direct clients
    if (this.directConnections.size === 0) {
      this.addDirectMessage('No clients connected', 'system');
      return;
    }
    
    this.addDirectMessage(`Me: ${text}`, 'own');
    
    this.directConnections.forEach((connection, appId) => {
      try {
        connection.send('message', { text, from: NICKNAME });
      } catch (err) {
        console.error(`Failed to send to ${appId}:`, err);
      }
    });
  }

  addDirectMessage(text, type = 'other') {
    const div = document.createElement('div');
    div.className = `chat-message ${type}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<span class="time">${time}</span>${text}`;
    
    this.directChat.appendChild(div);
    this.directChat.scrollTop = this.directChat.scrollHeight;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ClientAApp());
} else {
  new ClientAApp();
}

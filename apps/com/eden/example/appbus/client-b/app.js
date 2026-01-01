// AppBus Client B
// Connects to Hub for mediated chat only (no direct chat)

const CLIENT_ID = 'com.eden.example.appbus.client-b';
const NICKNAME = 'Client B';

class ClientBApp {
  constructor() {
    this.hubConnection = null;
    
    // DOM elements
    this.hubStatus = document.getElementById('hub-status');
    this.hubClientsCount = document.getElementById('hub-clients-count');
    this.hubChat = document.getElementById('hub-chat');
    this.hubMessage = document.getElementById('hub-message');
    this.hubSendBtn = document.getElementById('hub-send-btn');
    
    this.setupEventListeners();
    this.connectToHub();
  }

  setupEventListeners() {
    this.hubSendBtn.addEventListener('click', () => this.sendHubMessage());
    this.hubMessage.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendHubMessage();
    });
  }

  async connectToHub() {
    this.addMessage('Connecting to Hub...', 'system');
    
    try {
      const result = await window.appBus.connect(
        'com.eden.example.appbus.hub',
        'chat-relay'
      );

      if ('error' in result) {
        this.addMessage(`Failed: ${result.error}`, 'system');
        return;
      }

      this.hubConnection = result;
      this.hubStatus.textContent = 'Connected';
      this.hubStatus.className = 'eden-badge eden-badge-success';

      // Listen for incoming messages
      this.hubConnection.on('chat-message', (data) => {
        const isOwn = data.from === CLIENT_ID;
        this.addMessage(`${data.nickname}: ${data.message}`, isOwn ? 'own' : 'other');
      });

      this.hubConnection.on('client-joined', (data) => {
        this.addMessage(`${data.nickname} joined the chat`, 'system');
        this.updateClientCount();
      });

      this.hubConnection.on('client-left', (data) => {
        this.addMessage(`${data.nickname} left the chat`, 'system');
        this.updateClientCount();
      });

      // Join the chat
      const joinResult = await this.hubConnection.request('join', {
        clientId: CLIENT_ID,
        nickname: NICKNAME
      });

      if (joinResult.success) {
        this.addMessage('Joined hub chat!', 'system');
        this.hubClientsCount.textContent = joinResult.clients.length;
      }

    } catch (err) {
      this.addMessage(`Error: ${err.message}`, 'system');
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
      this.addMessage(`Send failed: ${err.message}`, 'system');
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

  addMessage(text, type = 'other') {
    const div = document.createElement('div');
    div.className = `chat-message ${type}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<span class="time">${time}</span>${text}`;
    
    this.hubChat.appendChild(div);
    this.hubChat.scrollTop = this.hubChat.scrollHeight;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new ClientBApp());
} else {
  new ClientBApp();
}

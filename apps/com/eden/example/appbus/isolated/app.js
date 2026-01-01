// AppBus Isolated
// Only connects directly to Client A's direct-chat service (no Hub involvement)

class IsolatedApp {
  constructor() {
    this.connection = null;
    
    // DOM elements
    this.connectionStatus = document.getElementById('connection-status');
    this.chat = document.getElementById('chat');
    this.messageInput = document.getElementById('message');
    this.sendBtn = document.getElementById('send-btn');
    
    this.setupEventListeners();
    this.connectToClientA();
  }

  setupEventListeners() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.messageInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.sendMessage();
    });
  }

  async connectToClientA() {
    this.addMessage('Connecting to Client A...', 'system');
    this.sendBtn.disabled = true;
    
    try {
      const result = await window.appBus.connect(
        'com.eden.example.appbus.client-a',
        'direct-chat'
      );

      if ('error' in result) {
        this.addMessage(`Failed: ${result.error}`, 'system');
        this.addMessage('Make sure Client A is running!', 'system');
        
        // Retry after 3 seconds
        setTimeout(() => this.connectToClientA(), 3000);
        return;
      }

      this.connection = result;
      this.connectionStatus.textContent = 'Connected';
      this.connectionStatus.className = 'eden-badge eden-badge-success';
      this.sendBtn.disabled = false;

      // Test connection with ping
      try {
        const pingResult = await this.connection.request('ping', {});
        this.addMessage(`Connected to ${pingResult.from}!`, 'system');
      } catch (err) {
        this.addMessage('Connected (ping failed)', 'system');
      }

      // Listen for messages from Client A (bidirectional!)
      this.connection.on('message', (data) => {
        this.addMessage(`Client A: ${data.text}`, 'other');
      });

    } catch (err) {
      this.addMessage(`Error: ${err.message}`, 'system');
      
      // Retry after 3 seconds
      setTimeout(() => this.connectToClientA(), 3000);
    }
  }

  sendMessage() {
    const text = this.messageInput.value.trim();
    if (!text || !this.connection) return;

    this.messageInput.value = '';
    this.addMessage(`Me: ${text}`, 'own');

    // Use send() for fire-and-forget messaging (bidirectional)
    this.connection.send('message', { text });
  }

  addMessage(text, type = 'other') {
    const div = document.createElement('div');
    div.className = `chat-message ${type}`;
    
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    div.innerHTML = `<span class="time">${time}</span>${text}`;
    
    this.chat.appendChild(div);
    this.chat.scrollTop = this.chat.scrollHeight;
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new IsolatedApp());
} else {
  new IsolatedApp();
}

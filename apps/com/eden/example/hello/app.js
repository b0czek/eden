// Example App Frontend Logic

class HelloApp {
  constructor() {
    this.statusDiv = document.getElementById('status');
    this.setupEventListeners();
    this.setupMessageListeners();
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

  setupMessageListeners() {
    const appAPI = window.getAppAPI();

    // Listen for fire-and-forget messages from backend
    appAPI.on('backend-ready', (payload) => {
      this.log(`✓ ${payload.message}`);
    });

    appAPI.on('heartbeat', (payload) => {
      console.log('Heartbeat from backend:', payload);
    });
  }

  async pingBackend() {
    this.log('Sending ping to backend...');
    
    try {
      const response = await window.getAppAPI().request('ping', {});
      this.log(`Pong received! Message count: ${response.messageCount}`);
    } catch (error) {
      this.log(`Error: ${error.message}`);
    }
  }

  async getBackendStatus() {
    this.log('Requesting backend status...');
    
    try {
      const response = await window.getAppAPI().request('get-status', {});
      this.log(`Status: ${response.status}`);
      this.log(`Uptime: ${response.uptime.toFixed(2)}s`);
      this.log(`Messages: ${response.messageCount}`);
    } catch (error) {
      this.log(`Error: ${error.message}`);
    }
  }

  async sayHello() {
    const userMessage = await this.showInputDialog(
      'Say Hello', 
      'What would you like to say?', 
      'Hello from frontend!'
    );
    if (!userMessage) return;

    this.log(`Sending: "${userMessage}"`);
    
    try {
      const response = await window.getAppAPI().request('hello', { message: userMessage });
      this.log(`Backend says: ${response.message}`);
    } catch (error) {
      this.log(`Error: ${error.message}`);
    }
  }

  /**
   * Show an input dialog modal (replaces native prompt)
   * @param {string} title - Dialog title
   * @param {string} placeholder - Input placeholder text
   * @param {string} defaultValue - Default input value
   * @returns {Promise<string|null>} - User's input or null if cancelled
   */
  showInputDialog(title, placeholder = 'Enter value...', defaultValue = '') {
    return new Promise((resolve) => {
      const overlay = document.getElementById('input-dialog');
      const titleEl = document.getElementById('input-dialog-title');
      const input = document.getElementById('input-dialog-input');
      const closeBtn = document.getElementById('input-dialog-close');
      const cancelBtn = document.getElementById('input-dialog-cancel');
      const confirmBtn = document.getElementById('input-dialog-confirm');

      // Set up the dialog
      titleEl.textContent = title;
      input.placeholder = placeholder;
      input.value = defaultValue;
      overlay.style.display = 'flex';

      // Focus the input after a short delay to ensure modal is visible
      setTimeout(() => input.focus(), 100);

      const cleanup = (result) => {
        overlay.style.display = 'none';
        input.value = '';
        resolve(result);
      };

      const handleConfirm = () => {
        const value = input.value.trim();
        cleanup(value || null);
      };

      const handleCancel = () => {
        cleanup(null);
      };

      // Event listeners
      confirmBtn.onclick = handleConfirm;
      cancelBtn.onclick = handleCancel;
      closeBtn.onclick = handleCancel;

      // Handle Enter key to confirm
      const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
          handleConfirm();
          input.removeEventListener('keydown', handleKeyDown);
        } else if (e.key === 'Escape') {
          handleCancel();
          input.removeEventListener('keydown', handleKeyDown);
        }
      };
      input.addEventListener('keydown', handleKeyDown);

      // Close on overlay click
      overlay.onclick = (e) => {
        if (e.target === overlay) {
          handleCancel();
        }
      };
    });
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
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => new HelloApp());
} else {
  new HelloApp();
}

/**
 * Eden App Frame Injector
 * 
 * This script is injected into every app to add a title bar with close button
 */

(function() {
  console.log('[Eden Frame] Injection script started');
  
  // Check if already injected
  if (window.__edenFrameInjected) {
    console.log('[Eden Frame] Already injected, skipping');
    return;
  }
  window.__edenFrameInjected = true;

  let appId = null;
  let appName = 'App';

  // Inject CSS
  const style = document.createElement('style');
  style.textContent = `
    #eden-app-frame-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      background: linear-gradient(to bottom, #f5f5f5, #e8e8e8);
      border-bottom: 1px solid #d0d0d0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 8px;
      user-select: none;
      z-index: 999999;
      -webkit-app-region: drag;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    }

    #eden-app-frame-overlay.dark {
      background: linear-gradient(to bottom, #3c3c3c, #2d2d2d);
      border-bottom: 1px solid #1e1e1e;
      color: #cccccc;
    }

    #eden-app-frame-title {
      font-size: 13px;
      font-weight: 500;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
    }

    #eden-app-frame-overlay.dark #eden-app-frame-title {
      color: #cccccc;
    }

    #eden-app-frame-controls {
      display: flex;
      gap: 8px;
      -webkit-app-region: no-drag;
    }

    .eden-app-frame-button {
      width: 24px;
      height: 24px;
      border: none;
      border-radius: 4px;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: background-color 0.15s;
      color: #666;
      line-height: 1;
      font-family: Arial, sans-serif;
    }

    #eden-app-frame-overlay.dark .eden-app-frame-button {
      color: #aaa;
    }

    .eden-app-frame-button:hover {
      background: rgba(0, 0, 0, 0.05);
    }

    #eden-app-frame-overlay.dark .eden-app-frame-button:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .eden-app-frame-button.close:hover {
      background: #e81123;
      color: white;
    }

    /* Adjust body to account for title bar */
    body.eden-framed {
      padding-top: 33px !important;
    }
  `;
  document.head.appendChild(style);

  // Create the overlay
  const overlay = document.createElement('div');
  overlay.id = 'eden-app-frame-overlay';
  overlay.innerHTML = `
    <div id="eden-app-frame-title">App</div>
    <div id="eden-app-frame-controls">
      <button class="eden-app-frame-button minimize" id="eden-minimize-btn" title="Minimize">−</button>
      <button class="eden-app-frame-button close" id="eden-close-btn" title="Close">×</button>
    </div>
  `;

  // Wait for DOM to be ready
  const injectOverlay = () => {
    console.log('[Eden Frame] injectOverlay called, body exists:', !!document.body);
    if (document.body) {
      document.body.insertBefore(overlay, document.body.firstChild);
      document.body.classList.add('eden-framed');
      console.log('[Eden Frame] Overlay injected into body');

      // Detect dark mode
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
      const updateTheme = (e) => {
        if (e.matches) {
          overlay.classList.add('dark');
        } else {
          overlay.classList.remove('dark');
        }
      };
      updateTheme(prefersDark);
      prefersDark.addEventListener('change', updateTheme);

      // Setup button handlers
      setupHandlers();
    } else {
      console.log('[Eden Frame] Body not ready, retrying...');
      setTimeout(injectOverlay, 10);
    }
  };

  const setupHandlers = () => {
    // Wait for appAPI to be available
    const waitForAPI = setInterval(() => {
      if (window.appAPI) {
        clearInterval(waitForAPI);
        appId = window.appAPI.getAppId();
        
        if (appId) {
          // Extract a readable name from the app ID
          const parts = appId.split('.');
          appName = parts[parts.length - 1] || appId;
          // Capitalize first letter
          appName = appName.charAt(0).toUpperCase() + appName.slice(1);
          
          const titleEl = document.getElementById('eden-app-frame-title');
          if (titleEl) {
            titleEl.textContent = appName;
          }
        }
      }
    }, 100);

    // Close button
    const closeBtn = document.getElementById('eden-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        // Wait for edenAPI to be available (from eve-preload)
        const stopApp = () => {
          if (window.edenAPI && appId) {
            window.edenAPI.shellCommand('stop-app', { appId }).catch(console.error);
          } else {
            setTimeout(stopApp, 100);
          }
        };
        stopApp();
      });
    }

    // Minimize button
    const minBtn = document.getElementById('eden-minimize-btn');
    if (minBtn) {
      minBtn.addEventListener('click', () => {
        const minimize = () => {
          if (window.edenAPI && appId) {
            window.edenAPI.shellCommand('set-view-visibility', { 
              appId, 
              visible: false 
            }).catch(console.error);
          } else {
            setTimeout(minimize, 100);
          }
        };
        minimize();
      });
    }

    // Maximize button (show if hidden, bring to front)
    const maxBtn = document.getElementById('eden-maximize-btn');
    if (maxBtn) {
      maxBtn.addEventListener('click', () => {
        const maximize = () => {
          if (window.edenAPI && appId) {
            // First make sure it's visible
            window.edenAPI.shellCommand('set-view-visibility', { 
              appId, 
              visible: true 
            }).then(() => {
              // Then bring to front
              return window.edenAPI.shellCommand('focus-app', { appId });
            }).catch(console.error);
          } else {
            setTimeout(maximize, 100);
          }
        };
        maximize();
      });
    }
  };

  // Inject when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectOverlay);
  } else {
    injectOverlay();
  }

  // Expose API for apps to update the title
  window.edenFrame = {
    setTitle: (title) => {
      const titleEl = document.getElementById('eden-app-frame-title');
      if (titleEl) {
        titleEl.textContent = title;
      }
    }
  };
})();

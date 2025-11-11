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
    /* Squircle container styling */
    html {
      background: transparent !important;
    }
    
    html, body {
      border-radius: 20px;
      overflow: hidden;
      clip-path: inset(0 round 20px);
    }
    
    body {
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15),
                  inset 0 0 0 1px rgba(0, 0, 0, 0.08);
    }

    #eden-app-frame-overlay#eden-app-frame-overlay {
      all: revert;
      /* Now only set what we actually need */
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: transparent;
      border-bottom: none;
      border-radius: 20px 20px 0 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 16px;
      user-select: none;
      z-index: 2147483647;
      -webkit-app-region: drag;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      box-sizing: border-box;
    }

    #eden-app-frame-overlay.dark#eden-app-frame-overlay.dark {
      background: transparent;
      border-bottom: none;
      color: #cccccc;
    }

    #eden-app-frame-overlay #eden-app-frame-title {
      all: revert;
      /* Now only set what we actually need */
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      font-size: 14px;
      font-weight: 600;
      color: #333;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: calc(100% - 200px);
      text-align: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      line-height: 1;
      letter-spacing: -0.3px;
      pointer-events: none;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 8px 16px;
      border-radius: 10px;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-sizing: border-box;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1),
                  inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }

        #eden-app-frame-overlay.dark #eden-app-frame-title {
      color: #ffffff;
      background: rgba(40, 40, 40, 0.7);
      backdrop-filter: blur(20px) saturate(180%);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3),
                  inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }

    #eden-app-frame-overlay #eden-app-frame-controls {
      all: revert;
      /* Now only set what we actually need */
      display: flex;
      gap: 8px;
      -webkit-app-region: no-drag;
      align-items: center;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(20px) saturate(180%);
      padding: 4px;
      border-radius: 10px;
      height: 32px;
      box-sizing: border-box;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1),
                  inset 0 1px 0 rgba(255, 255, 255, 0.5);
    }

    #eden-app-frame-overlay.dark #eden-app-frame-controls {
      background: rgba(40, 40, 40, 0.7);
      backdrop-filter: blur(20px) saturate(180%);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3),
                  inset 0 1px 0 rgba(255, 255, 255, 0.1);
    }

    #eden-app-frame-overlay .eden-app-frame-button {
      all: revert;
      /* Now only set what we actually need */
      width: 24px;
      height: 24px;
      min-width: 24px;
      min-height: 24px;
      max-width: 24px;
      max-height: 24px;
      border: none;
      border-radius: 6px;
      background: transparent;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      color: #666;
      line-height: 1;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
      font-weight: 400;
      padding: 0;
      margin: 0;
      box-sizing: border-box;
      flex-shrink: 0;
    }

    #eden-app-frame-overlay.dark .eden-app-frame-button {
      color: #aaa;
    }

    #eden-app-frame-overlay .eden-app-frame-button:hover {
      background: rgba(0, 0, 0, 0.08);
      transform: scale(1.05);
    }

    #eden-app-frame-overlay.dark .eden-app-frame-button:hover {
      background: rgba(255, 255, 255, 0.12);
      transform: scale(1.05);
    }

    #eden-app-frame-overlay .eden-app-frame-button.close:hover {
      background: #e81123;
      color: white;
      transform: scale(1.05);
    }

    #eden-app-frame-overlay .eden-app-frame-button:active {
      transform: scale(0.95);
    }

    #eden-app-frame-overlay .eden-app-frame-button.minimize {
      font-size: 20px;
      font-weight: 300;
    }

    #eden-app-frame-overlay .eden-app-frame-button.close {
      font-size: 20px;
      font-weight: 400;
    }

    /* Adjust body to account for title bar */
    body.eden-framed.eden-framed {
      padding-top: 41px;
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

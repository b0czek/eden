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
  
  // Track current window bounds for floating windows
  let currentBounds = null;

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
  
  // Check if app supports mode toggling
  const windowConfig = window.__edenWindowConfig || {};
  const supportsToggle = windowConfig.mode === 'both';
  const currentMode = window.__edenWindowMode || 'tiled';
  
  // Create toggle button HTML if supported
  const toggleButtonHtml = supportsToggle 
    ? `<button class="eden-app-frame-button toggle-mode" id="eden-toggle-mode-btn" title="Toggle Window Mode">⊞</button>` 
    : '';
  
  overlay.innerHTML = `
    <div id="eden-app-frame-title">App</div>
    <div id="eden-app-frame-controls">
      ${toggleButtonHtml}
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

    // Toggle mode button (only for apps that support 'both')
    const toggleBtn = document.getElementById('eden-toggle-mode-btn');
    if (toggleBtn) {
      toggleBtn.addEventListener('click', () => {
        const toggleMode = () => {
          if (window.edenAPI && appId) {
            window.edenAPI.shellCommand('toggle-view-mode', { 
              appId 
            }).then(() => {
              console.log('[Eden Frame] View mode toggled');
            }).catch(console.error);
          } else {
            setTimeout(toggleMode, 100);
          }
        };
        toggleMode();
      });
    }

    // Setup floating window dragging and resizing
    setupFloatingWindowControls();

    // Listen for mode changes from backend
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'view-mode-changed') {
        const { mode, bounds } = event.data;
        console.log('[Eden Frame] View mode changed to:', mode, 'with bounds:', bounds);
        
        // Update window mode and bounds
        window.__edenWindowMode = mode;
        if (bounds) {
          window.__edenInitialBounds = bounds;
          currentBounds = { ...bounds };
        }
        
        // Re-setup controls for new mode
        setupFloatingWindowControls();
      }
    });
  };

  const setupFloatingWindowControls = () => {
    const windowMode = window.__edenWindowMode || 'tiled';
    const windowConfig = window.__edenWindowConfig || {};
    const initialBounds = window.__edenInitialBounds || null;

    console.log('[Eden Frame] Window mode:', windowMode, 'Config:', windowConfig, 'Initial bounds:', initialBounds);

    // Only enable dragging/resizing for floating windows
    if (windowMode !== 'floating') {
      return;
    }

    // Initialize current bounds from the actual bounds set by ViewManager
    if (initialBounds && initialBounds.x !== undefined) {
      currentBounds = { ...initialBounds };
      console.log('[Eden Frame] Initialized bounds from backend:', currentBounds);
    } else if (windowConfig.defaultSize) {
      // Fallback to config if no initial bounds provided
      const workspaceX = 0;
      const workspaceY = 0;
      
      const x = windowConfig.defaultPosition?.x || 0;
      const y = windowConfig.defaultPosition?.y || 0;
      
      currentBounds = {
        x: workspaceX + x,
        y: workspaceY + y,
        width: windowConfig.defaultSize.width || 800,
        height: windowConfig.defaultSize.height || 600
      };
      
      console.log('[Eden Frame] Initialized bounds from config:', currentBounds);
    }

    // Check if dragging is allowed
    const isMovable = windowConfig.movable !== false; // default true
    const isResizable = windowConfig.resizable !== false; // default true

    console.log('[Eden Frame] Movable:', isMovable, 'Resizable:', isResizable);

    // Setup window dragging
    if (isMovable) {
      setupWindowDragging();
    }

    // Setup window resizing
    if (isResizable) {
      setupWindowResizing(windowConfig);
    }
  };

  const setupWindowDragging = () => {
    const titleBar = overlay;
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let dragStartBounds = null;

    titleBar.addEventListener('mousedown', (e) => {
      // Only drag on the title bar itself, not on buttons
      if (e.target.closest('.eden-app-frame-button')) {
        return;
      }

      // Initialize current bounds if not set
      if (!currentBounds) {
        const windowConfig = window.__edenWindowConfig || {};
        currentBounds = {
          x: 0,
          y: 0,
          width: windowConfig.defaultSize?.width || 800,
          height: windowConfig.defaultSize?.height || 600
        };
      }

      isDragging = true;
      startX = e.screenX;
      startY = e.screenY;
      // Copy current bounds at drag start
      dragStartBounds = { ...currentBounds };

      console.log('[Eden Frame] Drag started at:', { x: startX, y: startY }, 'Current bounds:', currentBounds);

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging || !dragStartBounds) return;

      const deltaX = e.screenX - startX;
      const deltaY = e.screenY - startY;

      const newBounds = {
        x: dragStartBounds.x + deltaX,
        y: dragStartBounds.y + deltaY,
        width: dragStartBounds.width,
        height: dragStartBounds.height
      };

      // Update tracked bounds
      currentBounds = newBounds;

      // Send update to backend
      if (window.edenAPI && appId) {
        window.edenAPI.shellCommand('update-view-bounds', {
          appId,
          bounds: newBounds
        }).catch(console.error);
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        console.log('[Eden Frame] Drag ended, final bounds:', currentBounds);
        isDragging = false;
        dragStartBounds = null;
      }
    });
  };

  const setupWindowResizing = (windowConfig) => {
    // Create resize handle in bottom-right corner
    const resizeHandle = document.createElement('div');
    resizeHandle.id = 'eden-resize-handle';
    resizeHandle.style.cssText = `
      position: fixed;
      bottom: 0;
      right: 0;
      width: 20px;
      height: 20px;
      cursor: nwse-resize;
      z-index: 2147483647;
      -webkit-app-region: no-drag;
    `;

    document.body.appendChild(resizeHandle);

    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let resizeStartBounds = null;

    resizeHandle.addEventListener('mousedown', (e) => {
      // Initialize current bounds if not set
      if (!currentBounds) {
        currentBounds = {
          x: 0,
          y: 0,
          width: windowConfig.defaultSize?.width || 800,
          height: windowConfig.defaultSize?.height || 600
        };
      }

      isResizing = true;
      startX = e.screenX;
      startY = e.screenY;

      // Copy current bounds at resize start
      resizeStartBounds = { ...currentBounds };

      console.log('[Eden Frame] Resize started at:', { x: startX, y: startY }, 'Current bounds:', currentBounds);

      e.preventDefault();
      e.stopPropagation();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isResizing || !resizeStartBounds) return;

      const deltaX = e.screenX - startX;
      const deltaY = e.screenY - startY;

      let newWidth = resizeStartBounds.width + deltaX;
      let newHeight = resizeStartBounds.height + deltaY;

      // Apply min/max constraints
      if (windowConfig.minSize) {
        newWidth = Math.max(newWidth, windowConfig.minSize.width || 200);
        newHeight = Math.max(newHeight, windowConfig.minSize.height || 200);
      } else {
        newWidth = Math.max(newWidth, 200);
        newHeight = Math.max(newHeight, 200);
      }

      if (windowConfig.maxSize) {
        newWidth = Math.min(newWidth, windowConfig.maxSize.width || 2000);
        newHeight = Math.min(newHeight, windowConfig.maxSize.height || 2000);
      }

      const newBounds = {
        x: resizeStartBounds.x,
        y: resizeStartBounds.y,
        width: Math.round(newWidth),
        height: Math.round(newHeight)
      };

      // Update tracked bounds
      currentBounds = newBounds;

      // Send update to backend
      if (window.edenAPI && appId) {
        window.edenAPI.shellCommand('update-view-bounds', {
          appId,
          bounds: newBounds
        }).catch(console.error);
      }
    });

    document.addEventListener('mouseup', () => {
      if (isResizing) {
        console.log('[Eden Frame] Resize ended, final bounds:', currentBounds);
        isResizing = false;
        resizeStartBounds = null;
      }
    });
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

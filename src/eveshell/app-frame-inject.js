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
      overflow: hidden;
    }
    
    html, body {
      border-radius: 20px;
      clip-path: inset(0 round 20px);
      margin: 0;
      padding: 0;
      height: 100%;
    }
    
    body {
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15),
                  inset 0 0 0 1px rgba(0, 0, 0, 0.08);
      overflow-y: auto;
      overflow-x: hidden;
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
      -webkit-app-region: no-drag;
      touch-action: none;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      pointer-events: auto;
      will-change: transform;
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
    let isTouch = false;
    let rafId = null;
    let pendingBounds = null;

    const getScreenCoords = (e) => {
      // For mouse events, use screenX/screenY directly
      if (e.screenX !== undefined && e.screenY !== undefined) {
        return { x: e.screenX, y: e.screenY };
      }
      
      // For touch events, calculate screen coordinates from client coordinates
      if (e.touches && e.touches[0]) {
        const touch = e.touches[0];
        // Try touch.screenX/screenY first (if available)
        if (touch.screenX !== undefined && touch.screenY !== undefined) {
          return { x: touch.screenX, y: touch.screenY };
        }
        // Fallback: calculate from clientX/clientY + view bounds position
        // Use currentBounds which has the actual view position
        if (currentBounds) {
          return {
            x: currentBounds.x + touch.clientX,
            y: currentBounds.y + touch.clientY
          };
        }
        // Last resort: use window.screenX/screenY
        return {
          x: touch.clientX + (window.screenX || 0),
          y: touch.clientY + (window.screenY || 0)
        };
      }
      
      return { x: 0, y: 0 };
    };

    const startDrag = (e) => {
      // Only drag on the title bar itself, not on buttons
      if (e.target.closest('.eden-app-frame-button')) {
        return;
      }

      console.log('[Eden Frame] startDrag called, event type:', e.type);
      console.log('[Eden Frame] currentBounds before refresh:', currentBounds);

      // ALWAYS refresh currentBounds at start to handle case where mouse drag updated position
      const initialBounds = window.__edenInitialBounds;
      if (initialBounds && initialBounds.x !== undefined) {
        currentBounds = { ...initialBounds };
        console.log('[Eden Frame] Refreshed currentBounds from __edenInitialBounds:', currentBounds);
      } else if (!currentBounds) {
        console.warn('[Eden Frame] Cannot start drag - currentBounds not initialized!');
        return;
      }

      isDragging = true;
      isTouch = e.type.startsWith('touch');
      
      // Get screen coordinates
      const coords = getScreenCoords(e);
      startX = coords.x;
      startY = coords.y;
      dragStartBounds = { ...currentBounds };
      
      console.log('[Eden Frame] Drag started at:', coords, 'isTouch:', isTouch);

      // IMPORTANT: Prevent default FIRST to stop touch from being canceled
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();

      // Start animation frame loop for smooth updates
      if (isTouch) {
        rafId = requestAnimationFrame(updatePosition);
      }

      // Bring window to front - but ONLY for mouse events
      // For touch, calling focus-app during the touch causes view reordering which triggers touchcancel
      // Touch users need to tap elsewhere to focus, then tap title bar to drag
      if (!isTouch && window.edenAPI && appId) {
        window.edenAPI.shellCommand('focus-app', { appId }).catch(console.error);
      }

      // For mouse events, use global tracking in main process
      // For touch events, we'll handle updates in touchmove
      if (!isTouch && window.edenAPI && appId) {
        window.edenAPI.shellCommand('start-drag', {
          appId,
          startX: coords.x,
          startY: coords.y
        }).catch(console.error);
      }

      // Add mouseup listener when drag starts (removed when drag ends)
      if (!isTouch) {
        window.addEventListener('mouseup', endDrag);
      }
    };

    // Animation frame update function - throttles IPC to 60fps
    const updatePosition = () => {
      if (pendingBounds && window.edenAPI && appId) {
        window.edenAPI.shellCommand('update-view-bounds', {
          appId,
          bounds: pendingBounds
        }).catch(console.error);
        
        pendingBounds = null;
      }
      
      if (isDragging) {
        rafId = requestAnimationFrame(updatePosition);
      }
    };

    const moveDrag = (e) => {
      // Prevent default immediately
      e.preventDefault();
      e.stopPropagation();
      
      if (!isDragging || !dragStartBounds) {
        return;
      }

      // Get current coordinates
      const coords = getScreenCoords(e);
      const deltaX = coords.x - startX;
      const deltaY = coords.y - startY;

      const newBounds = {
        x: dragStartBounds.x + deltaX,
        y: dragStartBounds.y + deltaY,
        width: dragStartBounds.width,
        height: dragStartBounds.height
      };

      // Update tracked bounds immediately for next move calculation
      currentBounds = newBounds;
      
      // Store pending update for next animation frame
      pendingBounds = newBounds;
    };

    const endDrag = (e) => {
      // For touch events, only end if there are no remaining touches
      if (e.type.startsWith('touch') && e.touches && e.touches.length > 0) {
        return;
      }
      
      if (!isDragging) {
        return;
      }

      console.log('[Eden Frame] Drag ended, final currentBounds:', currentBounds);
      isDragging = false;
      dragStartBounds = null;

      // Remove mouseup listener since drag is done
      window.removeEventListener('mouseup', endDrag);

      // Cancel animation frame and send final position
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        
        // Send final pending bounds immediately
        if (pendingBounds && window.edenAPI && appId) {
          window.edenAPI.shellCommand('update-view-bounds', {
            appId,
            bounds: pendingBounds
          }).catch(console.error);
          
          // Update __edenInitialBounds so next interaction starts from correct position
          window.__edenInitialBounds = { ...pendingBounds };
          pendingBounds = null;
        }
      }

      // For touch drag, ensure __edenInitialBounds is updated with final position
      if (isTouch && currentBounds) {
        window.__edenInitialBounds = { ...currentBounds };
        console.log('[Eden Frame] Updated __edenInitialBounds after touch drag:', window.__edenInitialBounds);
      }

      // Stop global drag tracking in main process (for mouse events)
      if (!isTouch && window.edenAPI && appId) {
        window.edenAPI.shellCommand('end-drag', { appId }).catch(console.error);
      }
    };

    // Mouse events
    titleBar.addEventListener('mousedown', startDrag);
    
    // Touch events - don't use capture for start, do use for move
    titleBar.addEventListener('touchstart', startDrag, { passive: false });

    // Move events for touch (mouse uses main process tracking)  
    // Use capture for move to ensure we get it
    document.addEventListener('touchmove', moveDrag, { passive: false, capture: true });

    // Touch end/cancel events (mouseup is added dynamically when drag starts)
    document.addEventListener('touchend', endDrag, { passive: false });
    document.addEventListener('touchcancel', endDrag, { passive: false });
    
    console.log('[Eden Frame] Drag event listeners registered');
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
      touch-action: none;
    `;

    document.body.appendChild(resizeHandle);

    let isResizing = false;
    let startX = 0;
    let startY = 0;
    let resizeStartBounds = null;
    let isTouch = false;
    let rafId = null;
    let pendingBounds = null;

    const getScreenCoords = (e) => {
      // For mouse events, use screenX/screenY directly
      if (e.screenX !== undefined && e.screenY !== undefined) {
        return { x: e.screenX, y: e.screenY };
      }
      
      // For touch events, calculate screen coordinates from client coordinates
      if (e.touches && e.touches[0]) {
        const touch = e.touches[0];
        // Try touch.screenX/screenY first (if available)
        if (touch.screenX !== undefined && touch.screenY !== undefined) {
          return { x: touch.screenX, y: touch.screenY };
        }
        // Fallback: calculate from clientX/clientY + view bounds position
        // Use currentBounds which has the actual view position
        if (currentBounds) {
          return {
            x: currentBounds.x + touch.clientX,
            y: currentBounds.y + touch.clientY
          };
        }
        // Last resort: use window.screenX/screenY
        return {
          x: touch.clientX + (window.screenX || 0),
          y: touch.clientY + (window.screenY || 0)
        };
      }
      
      return { x: 0, y: 0 };
    };

    const startResize = (e) => {
      console.log('[Eden Frame] startResize called, event type:', e.type);

      // Initialize current bounds if not set
      if (!currentBounds) {
        const initialBounds = window.__edenInitialBounds;
        if (initialBounds && initialBounds.x !== undefined) {
          currentBounds = { ...initialBounds };
          console.log('[Eden Frame] Initialized currentBounds from __edenInitialBounds:', currentBounds);
        } else {
          console.warn('[Eden Frame] Cannot start resize - currentBounds not initialized!');
          return;
        }
      }

      isResizing = true;
      isTouch = e.type.startsWith('touch');
      
      // Get screen coordinates
      const coords = getScreenCoords(e);
      startX = coords.x;
      startY = coords.y;
      resizeStartBounds = { ...currentBounds };

      console.log('[Eden Frame] Resize started at:', coords, 'isTouch:', isTouch);

      e.preventDefault();
      e.stopPropagation();

      // Start animation frame loop for smooth updates
      if (isTouch) {
        rafId = requestAnimationFrame(updateResizePosition);
      }

      // Bring window to front - but ONLY for mouse events
      // For touch, calling focus-app during the touch causes view reordering which triggers touchcancel
      // Touch users need to tap elsewhere to focus, then tap resize handle
      if (!isTouch && window.edenAPI && appId) {
        window.edenAPI.shellCommand('focus-app', { appId }).catch(console.error);
      }

      // For mouse events, use global tracking in main process
      // For touch events, we'll handle updates in touchmove
      if (!isTouch && window.edenAPI && appId) {
        window.edenAPI.shellCommand('start-resize', {
          appId,
          startX: coords.x,
          startY: coords.y
        }).catch(console.error);
      }

      // Add mouseup listener when resize starts (removed when resize ends)
      if (!isTouch) {
        window.addEventListener('mouseup', endResize);
      }
    };

    // Animation frame update function - throttles IPC to 60fps
    const updateResizePosition = () => {
      if (pendingBounds && window.edenAPI && appId) {
        window.edenAPI.shellCommand('update-view-bounds', {
          appId,
          bounds: pendingBounds
        }).catch(console.error);
        
        pendingBounds = null;
      }
      
      if (isResizing) {
        rafId = requestAnimationFrame(updateResizePosition);
      }
    };

    const moveResize = (e) => {
      console.log('[Eden Frame] moveResize called, isResizing:', isResizing, 'event type:', e.type);
      
      e.preventDefault();
      e.stopPropagation();
      
      if (!isResizing || !resizeStartBounds) {
        console.log('[Eden Frame] moveResize returning early - isResizing:', isResizing, 'resizeStartBounds:', resizeStartBounds);
        return;
      }

      // Get current coordinates
      const coords = getScreenCoords(e);
      const deltaX = coords.x - startX;
      const deltaY = coords.y - startY;

      console.log('[Eden Frame] moveResize coords:', coords, 'delta:', { deltaX, deltaY });

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

      console.log('[Eden Frame] moveResize newBounds:', newBounds);

      // Update tracked bounds immediately for next move calculation
      currentBounds = newBounds;
      
      // Store pending update for next animation frame
      pendingBounds = newBounds;
    };

    const endResize = (e) => {
      if (!isResizing) {
        return;
      }

      console.log('[Eden Frame] Resize ended, final currentBounds:', currentBounds);
      isResizing = false;
      resizeStartBounds = null;

      // Remove mouseup listener since resize is done
      window.removeEventListener('mouseup', endResize);

      // Cancel animation frame and send final position
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
        
        // Send final pending bounds immediately
        if (pendingBounds && window.edenAPI && appId) {
          window.edenAPI.shellCommand('update-view-bounds', {
            appId,
            bounds: pendingBounds
          }).catch(console.error);
          
          // Update __edenInitialBounds so next interaction starts from correct position
          window.__edenInitialBounds = { ...pendingBounds };
          pendingBounds = null;
        }
      }

      // For touch resize, ensure __edenInitialBounds is updated with final position
      if (isTouch && currentBounds) {
        window.__edenInitialBounds = { ...currentBounds };
        console.log('[Eden Frame] Updated __edenInitialBounds after touch resize:', window.__edenInitialBounds);
      }

      // Stop global resize tracking in main process (for mouse events)
      if (!isTouch && window.edenAPI && appId) {
        window.edenAPI.shellCommand('end-resize', { appId }).catch(console.error);
      }
    };

    // Mouse events
    resizeHandle.addEventListener('mousedown', startResize);
    
    // Touch events
    resizeHandle.addEventListener('touchstart', startResize, { passive: false });

    // Move events for touch (mouse uses main process tracking)
    // Use document and capture to ensure we get all touch moves
    document.addEventListener('touchmove', moveResize, { passive: false, capture: true });

    // Touch end/cancel events (mouseup is added dynamically when resize starts)
    document.addEventListener('touchend', endResize, { passive: false });
    document.addEventListener('touchcancel', endResize, { passive: false });
    
    console.log('[Eden Frame] Resize event listeners registered');
  };

  // Listen for bounds updates from main process (during mouse drag/resize)
  // This keeps currentBounds in sync even when main process is controlling movement
  if (window.appAPI && window.appAPI.onBoundsUpdated) {
    window.appAPI.onBoundsUpdated((newBounds) => {
      currentBounds = { ...newBounds };
      window.__edenInitialBounds = { ...newBounds };
    });
    console.log('[Eden Frame] Registered bounds update listener');
  } else {
    console.warn('[Eden Frame] appAPI.onBoundsUpdated not available');
  }

  // Add global touch handler to diagnose issues
  document.addEventListener('touchstart', (e) => {
    console.log('[Eden Frame] Global touchstart on:', e.target);
  }, { passive: false, capture: true });
  
  document.addEventListener('touchcancel', (e) => {
    console.log('[Eden Frame] Global touchcancel on:', e.target);
    console.log('[Eden Frame] Stack trace:', new Error().stack);
  }, { capture: true });

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

/**
 * Window Resizing
 * 
 * Handles resizing for floating windows
 */

import { getScreenCoords } from './utils.js';

interface Bounds {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface BoundsRef {
    current: Bounds | null;
}

/**
 * Setup window resizing for floating windows
 */
/**
 * Setup window resizing for floating windows
 */
export function setupWindowResizing(
    windowConfig: NonNullable<Window['edenFrame']>['_internal']['config'],
    currentBoundsRef: BoundsRef
): void {
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
    let resizeStartBounds: Bounds | null = null;
    let isTouch = false;
    let rafId: number | null = null;
    let pendingBounds: Bounds | null = null;

    // Animation frame update function - throttles IPC to 60fps
    const updateResizePosition = () => {
        const appId = window.appAPI?.getAppId();
        if (pendingBounds && window.edenAPI && appId) {
            window.edenAPI.shellCommand('app/update-view-bounds', {
                appId,
                bounds: pendingBounds
            }).catch(console.error);

            pendingBounds = null;
        }

        if (isResizing) {
            rafId = requestAnimationFrame(updateResizePosition);
        }
    };

    const startResize = (e: MouseEvent | TouchEvent): void => {
        console.log('[Eden Frame] startResize called, event type:', e.type);

        // Initialize current bounds if not set
        if (!currentBoundsRef.current) {
            const initialBounds = window.edenFrame?._internal.bounds;
            if (initialBounds && initialBounds.x !== undefined) {
                currentBoundsRef.current = { ...initialBounds };
                console.log('[Eden Frame] Initialized currentBounds from edenFrame._internal.bounds:', currentBoundsRef.current);
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
        resizeStartBounds = { ...currentBoundsRef.current };

        console.log('[Eden Frame] Resize started at:', coords, 'isTouch:', isTouch);

        e.preventDefault();
        e.stopPropagation();

        // Start animation frame loop for smooth updates
        if (isTouch) {
            rafId = requestAnimationFrame(updateResizePosition);
        }

        const appId = window.appAPI?.getAppId();

        // Bring window to front - but ONLY for mouse events
        // For touch, calling focus-app during the touch causes view reordering which triggers touchcancel
        // Touch users need to tap elsewhere to focus, then tap resize handle
        if (!isTouch && window.edenAPI && appId) {
            window.edenAPI.shellCommand('app/focus-app', { appId }).catch(console.error);
        }

        // For mouse events, use global tracking in main process
        // For touch events, we'll handle updates in touchmove
        if (!isTouch && window.edenAPI && appId) {
            window.edenAPI.shellCommand('app/start-resize', {
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

    const moveResize = (e: MouseEvent | TouchEvent): void => {
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
        currentBoundsRef.current = newBounds;

        // Store pending update for next animation frame
        pendingBounds = newBounds;
    };

    const endResize = (e?: MouseEvent | TouchEvent): void => {
        if (!isResizing) {
            return;
        }

        console.log('[Eden Frame] Resize ended, final currentBounds:', currentBoundsRef.current);
        isResizing = false;
        resizeStartBounds = null;

        // Remove mouseup listener since resize is done
        window.removeEventListener('mouseup', endResize);

        const appId = window.appAPI?.getAppId();

        // Cancel animation frame and send final position
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = null;

            // Send final pending bounds immediately
            if (pendingBounds && window.edenAPI && appId) {
                window.edenAPI.shellCommand('app/update-view-bounds', {
                    appId,
                    bounds: pendingBounds
                }).catch(console.error);

                // Update edenFrame._internal.bounds so next interaction starts from correct position
                window.edenFrame!._internal.bounds = { ...pendingBounds };
                pendingBounds = null;
            }
        }

        // For touch resize, ensure edenFrame._internal.bounds is updated with final position
        if (isTouch && currentBoundsRef.current) {
            window.edenFrame!._internal.bounds = { ...currentBoundsRef.current };
            console.log('[Eden Frame] Updated edenFrame._internal.bounds after touch resize:', window.edenFrame?._internal.bounds);
        }

        // Stop global resize tracking in main process (for mouse events)
        if (!isTouch && window.edenAPI && appId) {
            window.edenAPI.shellCommand('app/end-resize', { appId }).catch(console.error);
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
}

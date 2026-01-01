// Foundation Layer
// Handles workspace area reporting and global event handling

(function () {
    'use strict';

    console.log('Foundation layer initializing...');

    const workspace = document.getElementById('workspace');
    if (!workspace) {
        console.error('Workspace element not found!');
        return;
    }

    /**
     * Send the workspace bounding rectangle and current window size to the backend.
     *
     * The reported bounds contain x, y, width, and height; the height is reduced by 72 pixels.
     */
    function reportWorkspaceBounds() {
        const rect = workspace.getBoundingClientRect();
        const bounds = {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.round(rect.width),
            height: Math.round(rect.height) - 72,
        };

        // Get window size from body
        const windowSize = {
            width: Math.round(document.body.clientWidth),
            height: Math.round(document.body.clientHeight),
        };

        // Send to backend via eden API (provided by preload)
        window.edenAPI.shellCommand('view/update-global-bounds', { bounds, windowSize })
            .catch((error) => {
                console.error('Failed to update global bounds:', error);
            });
    }

    /**
     * Notify the backend of a global mouse-up to end any active drag or resize interactions.
     *
     * Sends the 'view/global-mouseup' shell command to the backend; any error from the call is logged to the console.
     */
    function handleGlobalMouseUp() {
        window.edenAPI.shellCommand('view/global-mouseup', {})
            .catch((error) => {
                console.error('Failed to send global-mouseup:', error);
            });
    }

    // Initial workspace bounds report
    reportWorkspaceBounds();

    // Watch for workspace resizes
    const resizeObserver = new ResizeObserver(() => {
        reportWorkspaceBounds();
    });
    resizeObserver.observe(workspace);

    // Listen for global mouseup events
    window.addEventListener('mouseup', handleGlobalMouseUp);

    // Listen for window resize events
    window.addEventListener('resize', () => {
        reportWorkspaceBounds();
    });

    console.log('Foundation layer initialized');
})();
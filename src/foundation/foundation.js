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
     * Report workspace bounds to the backend
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
     * Handle global mouseup events
     * Cleanup for any active drag/resize operations happening in app views
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

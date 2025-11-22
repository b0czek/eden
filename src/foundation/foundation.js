// Foundation Layer - Vanilla JavaScript
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
            height: Math.round(rect.height) - 80,
        };

        // Send to backend via eden API (provided by preload)
        if (window.edenAPI && window.edenAPI.shellCommand) {
            window.edenAPI.shellCommand('app/update-workspace-bounds', { bounds })
                .catch((error) => {
                    console.error('Failed to update workspace bounds:', error);
                });
        }
    }

    /**
     * Handle global mouseup events
     * Cleanup for any active drag/resize operations happening in app views
     */
    function handleGlobalMouseUp() {
        if (window.edenAPI && window.edenAPI.shellCommand) {
            window.edenAPI.shellCommand('app/global-mouseup', {})
                .catch((error) => {
                    console.error('Failed to send global-mouseup:', error);
                });
        }
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

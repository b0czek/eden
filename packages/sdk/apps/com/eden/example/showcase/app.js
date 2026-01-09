// Design Showcase App JavaScript

// Tab functionality
function setupTabs() {
  const tabLists = document.querySelectorAll('.eden-tab-list');
  
  tabLists.forEach(tabList => {
    const tabs = tabList.querySelectorAll('.eden-tab');
    const panels = tabList.closest('.eden-tabs').querySelectorAll('.eden-tab-panel');
    
    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => {
        // Remove active class from all tabs and panels
        tabs.forEach(t => t.classList.remove('eden-tab-active'));
        panels.forEach(p => p.classList.remove('eden-tab-panel-active'));
        
        // Add active class to clicked tab and corresponding panel
        tab.classList.add('eden-tab-active');
        panels[index].classList.add('eden-tab-panel-active');
      });
    });
  });
}

// Modal functionality
function showModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }
}

// Setup modal event listeners
function setupModals() {
  // Close on overlay click
  document.querySelectorAll('.eden-modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
        document.body.style.overflow = '';
      }
    });
  });
  
  // Close buttons
  document.querySelectorAll('.eden-modal-close').forEach(btn => {
    btn.addEventListener('click', () => {
      const modal = btn.closest('.eden-modal-overlay');
      if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = '';
      }
    });
  });
}

// Progress bar animation
function animateProgress() {
  const progressBars = document.querySelectorAll('.eden-progress-bar[data-target]');
  
  progressBars.forEach(bar => {
    const target = parseInt(bar.getAttribute('data-target'));
    setTimeout(() => {
      bar.style.width = target + '%';
    }, 100);
  });
}

// Slider value display
function setupSliders() {
  document.querySelectorAll('.eden-slider').forEach(slider => {
    const display = slider.nextElementSibling;
    if (display && display.classList.contains('slider-value')) {
      slider.addEventListener('input', (e) => {
        display.textContent = e.target.value;
      });
    }
  });
}

// Toggle notification badge
let notificationCount = 0;
function toggleNotification() {
  const badge = document.querySelector('.eden-notification-badge');
  if (badge) {
    notificationCount = (notificationCount + 1) % 10;
    badge.textContent = notificationCount || '';
    badge.style.display = notificationCount > 0 ? 'flex' : 'none';
  }
}

// Dropdown menu functionality
function setupDropdowns() {
  document.querySelectorAll('.eden-dropdown').forEach(dropdown => {
    const button = dropdown.querySelector('button');
    const menu = dropdown.querySelector('.eden-dropdown-menu');
    
    if (button && menu) {
      button.addEventListener('click', (e) => {
        e.stopPropagation();
        const isVisible = menu.style.display === 'block';
        
        // Close all other dropdowns
        document.querySelectorAll('.eden-dropdown-menu').forEach(m => {
          m.style.display = 'none';
        });
        
        menu.style.display = isVisible ? 'none' : 'block';
      });
    }
  });
  
  // Close dropdowns when clicking outside
  document.addEventListener('click', () => {
    document.querySelectorAll('.eden-dropdown-menu').forEach(m => {
      m.style.display = 'none';
    });
  });
}

// Toast notification system
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `eden-card eden-card-glass`;
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    z-index: 10000;
    min-width: 300px;
    padding: 16px 24px;
    animation: eden-slide-up 0.3s ease-out;
  `;
  
  const colors = {
    info: 'var(--eden-color-info)',
    success: 'var(--eden-color-success)',
    warning: 'var(--eden-color-warning)',
    danger: 'var(--eden-color-danger)'
  };
  
  toast.innerHTML = `
    <div style="display: flex; align-items: center; gap: 12px;">
      <div style="width: 4px; height: 40px; background: ${colors[type]}; border-radius: 999px;"></div>
      <div style="flex: 1;">
        <div style="font-weight: 600; margin-bottom: 4px; text-transform: capitalize;">${type}</div>
        <div style="font-size: 14px; color: var(--eden-color-text-secondary);">${message}</div>
      </div>
      <button onclick="this.closest('div').remove()" style="background: none; border: none; color: var(--eden-color-text-muted); cursor: pointer; font-size: 20px;">×</button>
    </div>
  `;
  
  document.body.appendChild(toast);
  
  setTimeout(() => {
    toast.style.animation = 'eden-fade-out 0.3s ease-out';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Initialize all functionality
document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupModals();
  setupSliders();
  setupDropdowns();
  animateProgress();
  
  console.log('Design Showcase initialized');
});

// Make functions globally available
window.showModal = showModal;
window.closeModal = closeModal;
window.showToast = showToast;
window.toggleNotification = toggleNotification;


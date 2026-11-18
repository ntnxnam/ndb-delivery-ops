import { useState, useEffect } from 'react';

class NotificationService {
  constructor() {
    this.notifications = [];
    this.listeners = [];
    this.nextId = 1;
  }

  // Add a new notification
  show(message, type = 'info', options = {}) {
    // Fix: Ensure message is always a string, never "[object Object]"
    let safeMessage = message;
    if (typeof message === 'object' && message !== null) {
      // If it's an error object, try to extract meaningful message
      safeMessage = message.message || message.error || message.toString();
    } else if (typeof message !== 'string') {
      safeMessage = String(message);
    }
    
    // Prevent "[object Object]" from ever appearing
    if (safeMessage === '[object Object]') {
      safeMessage = 'An unexpected error occurred';
    }
    
    const notification = {
      id: this.nextId++,
      message: safeMessage,
      type, // 'success', 'error', 'warning', 'info'
      duration: options.duration || (type === 'error' ? 8000 : 4000),
      persistent: options.persistent || false,
      action: options.action || null,
      timestamp: Date.now(),
      timeoutId: null
    };

    this.notifications.push(notification);
    this.notifyListeners();

    // Auto-remove non-persistent notifications
    if (!notification.persistent) {
      notification.timeoutId = setTimeout(() => {
        this.remove(notification.id);
      }, notification.duration);
    }

    return notification.id;
  }

  // Convenience methods
  success(message, options = {}) {
    return this.show(message, 'success', options);
  }

  error(message, options = {}) {
    return this.show(message, 'error', options);
  }

  warning(message, options = {}) {
    return this.show(message, 'warning', options);
  }

  info(message, options = {}) {
    return this.show(message, 'info', options);
  }

  // Remove a notification by ID
  remove(id) {
    // #region agent log
    // Removed debug telemetry
    // #endregion
    
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      const notification = this.notifications[index];
      
      // Clear any pending auto-dismiss timeout
      if (notification.timeoutId) {
        clearTimeout(notification.timeoutId);
        notification.timeoutId = null;
      }
      
      this.notifications.splice(index, 1);
      this.notifyListeners();
      
      // #region agent log
      // Removed debug telemetry
      // #endregion
    } else {
      // #region agent log
      // Removed debug telemetry
      // #endregion
    }
  }

  // Clear all notifications
  clear() {
    this.notifications = [];
    this.notifyListeners();
  }

  // Get all current notifications
  getAll() {
    return [...this.notifications];
  }

  // Subscribe to notification changes
  subscribe(listener) {
    this.listeners.push(listener);
    
    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  // Notify all listeners of changes
  notifyListeners() {
    // #region agent log
    // Removed debug telemetry
    // #endregion
    
    // Use a copy of notifications to prevent mutation during iteration
    const notificationsCopy = [...this.notifications];
    
    this.listeners.forEach((listener, index) => {
      try {
        // Ensure the listener is still valid (not from an unmounted component)
        if (typeof listener === 'function') {
          listener(notificationsCopy);
        }
      } catch (error) {
        console.error(`Error in notification listener ${index}:`, error);
        // Don't let one bad listener break the others
      }
    });
  }
}

export const notificationService = new NotificationService();

// React hook to use notifications

export const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    // Initial load
    const initial = notificationService.getAll();
    setNotifications(initial);
    
    // #region agent log
    // Removed debug telemetry
    // #endregion

    // Subscribe to changes
    const unsubscribe = notificationService.subscribe((newNotifications) => {
      // #region agent log
      // Removed debug telemetry
      // #endregion
      setNotifications(newNotifications);
    });

    return unsubscribe;
  }, []);

  return {
    notifications,
    show: notificationService.show.bind(notificationService),
    success: notificationService.success.bind(notificationService),
    error: notificationService.error.bind(notificationService),
    warning: notificationService.warning.bind(notificationService),
    info: notificationService.info.bind(notificationService),
    remove: notificationService.remove.bind(notificationService),
    clear: notificationService.clear.bind(notificationService)
  };
};
import { useState, useEffect, useCallback, useMemo } from 'react';

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
    const index = this.notifications.findIndex(n => n.id === id);
    if (index !== -1) {
      const notification = this.notifications[index];
      if (notification.timeoutId) {
        clearTimeout(notification.timeoutId);
        notification.timeoutId = null;
      }
      this.notifications.splice(index, 1);
      this.notifyListeners();
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

/**
 * React hook to use notifications. Callbacks are memoised with `useCallback([])` so
 * consumers can safely include `error`/`success` in `react-hooks/exhaustive-deps`
 * without triggering infinite fetch loops — fixes `ReleaseConfigPage` reload storm.
 * @returns {{notifications: Array, show: Function, success: Function, error: Function, warning: Function, info: Function, remove: Function, clear: Function}}
 */
export const useNotifications = () => {
  const [notifications, setNotifications] = useState([]);

  useEffect(() => {
    setNotifications(notificationService.getAll());
    const unsubscribe = notificationService.subscribe(setNotifications);
    return unsubscribe;
  }, []);

  const show = useCallback((message, type, options) => notificationService.show(message, type, options), []);
  const success = useCallback((message, options) => notificationService.success(message, options), []);
  const error = useCallback((message, options) => notificationService.error(message, options), []);
  const warning = useCallback((message, options) => notificationService.warning(message, options), []);
  const info = useCallback((message, options) => notificationService.info(message, options), []);
  const remove = useCallback((id) => notificationService.remove(id), []);
  const clear = useCallback(() => notificationService.clear(), []);

  return useMemo(() => ({
    notifications,
    show,
    success,
    error,
    warning,
    info,
    remove,
    clear,
  }), [notifications, show, success, error, warning, info, remove, clear]);
};
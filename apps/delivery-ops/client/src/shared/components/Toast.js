import React from 'react';
import { useNotifications } from '../services/notificationService';

export const Toast = (props) => {
  // Support two call shapes:
  //   1. ToastContainer:        <Toast notification={obj} onRemove={fn} />
  //   2. Standalone callers:    <Toast message="..." type="..." onClose={fn} id={...} action={...} />
  const notification = props.notification || {
    id: props.id,
    type: props.type,
    message: props.message,
    action: props.action,
  };
  const onRemove = props.onRemove || props.onClose;

  const getIcon = (type) => {
    switch (type) {
      case 'success': return '✅';
      case 'error': return '❌';
      case 'warning': return '⚠️';
      case 'info': return 'ℹ️';
      default: return 'ℹ️';
    }
  };

  const getTypeClass = (type) => {
    switch (type) {
      case 'success': return 'toast-success';
      case 'error': return 'toast-error';
      case 'warning': return 'toast-warning';
      case 'info': return 'toast-info';
      default: return 'toast-info';
    }
  };

  return (
    <div className={`toast ${getTypeClass(notification.type)}`}>
      <div className="toast-content">
        <div className="toast-icon">
          {getIcon(notification.type)}
        </div>
        <div className="toast-message">
          {notification.message}
        </div>
        {notification.action && (
          <button 
            className="toast-action"
            onClick={notification.action.onClick}
          >
            {notification.action.label}
          </button>
        )}
        <button 
          className="toast-close"
          onClick={(e) => {
            // #region agent log
            // Removed debug telemetry
            // #endregion
            
            // Call remove function immediately without interfering with event handling
            if (typeof onRemove === 'function') {
              onRemove(notification.id);
            }
            
            // Disable button after a brief delay to allow the removal to process
            setTimeout(() => {
              if (e.target) {
                e.target.disabled = true;
              }
            }, 10);
          }}
        >
          ×
        </button>
      </div>

      <style>{`
        .toast {
          min-width: 300px;
          max-width: 500px;
          margin-bottom: 12px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          animation: slideIn 0.3s ease-out;
          border-left: 4px solid;
        }

        .toast-success {
          background: #d4edda;
          color: #155724;
          border-left-color: #28a745;
        }

        .toast-error {
          background: #f8d7da;
          color: #721c24;
          border-left-color: #dc3545;
        }

        .toast-warning {
          background: #fff3cd;
          color: #856404;
          border-left-color: #ffc107;
        }

        .toast-info {
          background: #d1ecf1;
          color: #0c5460;
          border-left-color: #17a2b8;
        }

        .toast-content {
          display: flex;
          align-items: center;
          padding: 12px 16px;
          gap: 12px;
        }

        .toast-icon {
          font-size: 18px;
          flex-shrink: 0;
        }

        .toast-message {
          flex: 1;
          font-weight: 500;
          line-height: 1.4;
        }

        .toast-action {
          background: transparent;
          border: 1px solid currentColor;
          color: inherit;
          padding: 4px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: background-color 0.2s;
        }

        .toast-action:hover {
          background: rgba(0, 0, 0, 0.1);
        }

        .toast-close {
          background: transparent;
          border: none;
          color: inherit;
          font-size: 20px;
          cursor: pointer;
          padding: 0;
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 4px;
          transition: background-color 0.2s;
        }

        .toast-close:hover {
          background: rgba(0, 0, 0, 0.1);
        }

        /* Ensure close button can receive clicks */
        .toast-close {
          pointer-events: auto !important;
          z-index: 10;
        }

        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
};

export const ToastContainer = ({ position = 'top-right' }) => {
  const { notifications, remove } = useNotifications();

  // #region agent log
  React.useEffect(() => {
    // Removed debug telemetry
  });
  // #endregion

  if (notifications.length === 0) {
    // #region agent log
    // Removed debug telemetry
    // #endregion
    return null;
  }

  const getPositionClass = () => {
    switch (position) {
      case 'top-left': return 'toast-container-top-left';
      case 'top-right': return 'toast-container-top-right';
      case 'bottom-left': return 'toast-container-bottom-left';
      case 'bottom-right': return 'toast-container-bottom-right';
      case 'top-center': return 'toast-container-top-center';
      case 'bottom-center': return 'toast-container-bottom-center';
      default: return 'toast-container-top-right';
    }
  };

  return (
    <div className={`toast-container ${getPositionClass()}`}>
      {notifications.map(notification => (
        <Toast
          key={notification.id}
          notification={notification}
          onRemove={remove}
        />
      ))}

      <style>{`
        .toast-container {
          position: fixed;
          z-index: 9999;
          pointer-events: none;
        }

        .toast-container > :global(*) {
          pointer-events: auto;
        }

        /* Ensure all interactive elements work */
        :global(.toast) {
          pointer-events: auto;
        }
        
        :global(.toast-close) {
          pointer-events: auto !important;
        }

        .toast-container-top-right {
          top: 20px;
          right: 20px;
        }

        .toast-container-top-left {
          top: 20px;
          left: 20px;
        }

        .toast-container-bottom-right {
          bottom: 20px;
          right: 20px;
        }

        .toast-container-bottom-left {
          bottom: 20px;
          left: 20px;
        }

        .toast-container-top-center {
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
        }

        .toast-container-bottom-center {
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
        }
      `}</style>
    </div>
  );
};
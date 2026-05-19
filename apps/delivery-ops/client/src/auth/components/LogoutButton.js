import React from 'react';
import { useAuth } from '../hooks/useAuth';

export const LogoutButton = ({ 
  className = "", 
  children = "Logout",
  variant = "button", // "button" | "link"
  showIcon = false,
  showText = true
}) => {
  const { logout, user } = useAuth();

  const handleLogout = () => {
    logout();
  };

  const baseClasses = variant === "link" 
    ? "logout-link" 
    : "logout-button";
    
  const buttonClasses = `${baseClasses} ${className}`.trim();

  // Build content based on showIcon and showText props
  const buttonContent = (
    <>
      {showIcon && <span className="logout-icon">🚪</span>}
      {showText && <span className="logout-text">{children}</span>}
    </>
  );

  if (variant === "link") {
    return (
      <button 
        onClick={handleLogout}
        className={buttonClasses}
        type="button"
        title={`Logout ${user?.username || ''}`}
      >
        {buttonContent}
      </button>
    );
  }

  return (
    <button 
      onClick={handleLogout}
      className={buttonClasses}
      type="button"
      title={`Logout ${user?.username || ''}`}
    >
      {buttonContent}
    </button>
  );
};
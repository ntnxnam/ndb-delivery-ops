import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';

// Suppress ReactQuill findDOMNode deprecation warning (from third-party library)
// This warning is harmless and will be resolved when react-quill updates
// Must be set up before React is imported/used
if (process.env.NODE_ENV === 'development') {
  const originalWarn = console.warn;
  const originalError = console.error;
  
  const shouldSuppress = (args) => {
    // Check all arguments for the warning message
    return args.some(arg => {
      if (typeof arg === 'string') {
        return arg.includes('findDOMNode is deprecated') || 
               arg.includes('findDOMNode') ||
               arg.includes('ReactQuill');
      }
      return false;
    });
  };
  
  console.warn = (...args) => {
    if (shouldSuppress(args)) {
      // Suppress this specific warning from ReactQuill
      return;
    }
    originalWarn.apply(console, args);
  };
  
  console.error = (...args) => {
    if (shouldSuppress(args)) {
      // Suppress this specific error from ReactQuill
      return;
    }
    originalError.apply(console, args);
  };
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);


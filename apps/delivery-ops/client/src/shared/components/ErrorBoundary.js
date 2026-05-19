import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(_error) {
    // Update state so the next render will show the fallback UI
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    // Log the error to console and any error reporting service
    console.error('Error caught by ErrorBoundary:', error, errorInfo);
    
    this.setState({
      error: error,
      errorInfo: errorInfo
    });

    // You can also log the error to an error reporting service here
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.state.errorInfo);
      }

      // Default fallback UI
      return (
        <div className="error-boundary">
          <div className="error-boundary-content">
            <h2>🚨 Something went wrong</h2>
            <p>
              An unexpected error occurred. Please refresh the page or contact support if the problem persists.
            </p>
            
            {process.env.NODE_ENV === 'development' && (
              <details className="error-details">
                <summary>Error Details (Development Only)</summary>
                <div className="error-stack">
                  <h4>Error:</h4>
                  <pre>{this.state.error && this.state.error.toString()}</pre>
                  
                  <h4>Stack Trace:</h4>
                  <pre>{this.state.errorInfo?.componentStack || 'No stack trace available'}</pre>
                </div>
              </details>
            )}
            
            <div className="error-actions">
              <button 
                onClick={() => window.location.reload()}
                className="refresh-button"
              >
                Refresh Page
              </button>
              
              <button 
                onClick={() => this.setState({ hasError: false, error: null, errorInfo: null })}
                className="retry-button"
              >
                Try Again
              </button>
            </div>
          </div>

          <style>{`
            .error-boundary {
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 400px;
              padding: 24px;
              background: #f8f9fa;
              border: 1px solid #e9ecef;
              border-radius: 8px;
              margin: 16px 0;
            }

            .error-boundary-content {
              max-width: 600px;
              text-align: center;
            }

            .error-boundary h2 {
              color: #dc3545;
              margin-bottom: 16px;
              font-size: 24px;
            }

            .error-boundary p {
              color: #6c757d;
              margin-bottom: 24px;
              line-height: 1.5;
            }

            .error-details {
              text-align: left;
              margin: 24px 0;
              padding: 16px;
              background: #fff;
              border: 1px solid #dee2e6;
              border-radius: 4px;
            }

            .error-details summary {
              cursor: pointer;
              font-weight: 600;
              color: #495057;
              margin-bottom: 12px;
            }

            .error-stack {
              margin-top: 12px;
            }

            .error-stack h4 {
              color: #495057;
              margin: 16px 0 8px 0;
              font-size: 14px;
            }

            .error-stack pre {
              background: #f8f9fa;
              border: 1px solid #e9ecef;
              padding: 12px;
              border-radius: 4px;
              font-size: 12px;
              white-space: pre-wrap;
              color: #dc3545;
              overflow-x: auto;
            }

            .error-actions {
              display: flex;
              gap: 12px;
              justify-content: center;
            }

            .refresh-button, .retry-button {
              padding: 8px 16px;
              border: none;
              border-radius: 4px;
              cursor: pointer;
              font-weight: 500;
              transition: background-color 0.2s;
            }

            .refresh-button {
              background: #007bff;
              color: white;
            }

            .refresh-button:hover {
              background: #0056b3;
            }

            .retry-button {
              background: #6c757d;
              color: white;
            }

            .retry-button:hover {
              background: #5a6268;
            }
          `}</style>
        </div>
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export const withErrorBoundary = (Component, errorBoundaryProps = {}) => {
  return function WrappedComponent(props) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <Component {...props} />
      </ErrorBoundary>
    );
  };
};
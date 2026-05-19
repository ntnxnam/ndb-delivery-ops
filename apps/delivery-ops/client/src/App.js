import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/context/AuthContext';
import { TeamProvider } from './contexts/TeamContext';
import { ProtectedRoute } from './auth/components/ProtectedRoute';
import { LoginForm } from './auth/components/LoginForm';
import { Layout } from './layout/components/Layout';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { useAuth } from './auth/hooks/useAuth';

// Import existing components (these will be gradually migrated to the new modules)
import EmailSender from './components/EmailSender';
import ReleaseVersionTab from './components/ReleaseVersionTab';
import ReleaseTrendsPage from './components/ReleaseTrendsPage';
import ReleaseSetup from './components/ReleaseSetup';
import ReleaseConfigPage from './components/ReleaseConfigPage';
import GenericEmailer from './components/GenericEmailer';
import EmailHistoryTab from './components/EmailHistoryTab';
import SprintReportPage from './components/SprintReportPage';
import KPIPage from './components/KPIPage';
import AdminPanel from './components/AdminPanel/AdminPanel';
import ReleaseAnalysisPage from './components/ReleaseAnalysisPage';

import './App.css';

// Team configuration is now handled by TeamProvider context

// Login page component
const LoginPage = () => {
  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1>NDB Status Update Sender</h1>
          <p>Sign in with your JIRA API token</p>
        </div>
        <LoginForm 
          onSuccess={() => {
            // Navigation will be handled by the auth state change
          }}
          className="login-form"
        />
      </div>
      
      <style>{`
        .login-page {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          padding: 24px;
        }

        .login-container {
          background: white;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
          padding: 48px;
          max-width: 400px;
          width: 100%;
        }

        .login-header {
          text-align: center;
          margin-bottom: 32px;
        }

        .login-header h1 {
          color: #333;
          margin: 0 0 8px 0;
          font-size: 28px;
          font-weight: 600;
        }

        .login-header p {
          color: #6c757d;
          margin: 0;
          font-size: 16px;
        }

        .login-form {
          margin-top: 24px;
        }

        @media (max-width: 576px) {
          .login-container {
            padding: 32px 24px;
          }

          .login-header h1 {
            font-size: 24px;
          }
        }
      `}</style>
    </div>
  );
};

// Main authenticated app component
const AuthenticatedApp = () => {
  return (
    <TeamProvider>
      <Routes>
      <Route 
        path="/login" 
        element={<Navigate to="/" replace />} 
      />
      
      <Route 
        path="/" 
        element={
          <Layout>
            <EmailSender />
          </Layout>
        } 
      />
      
      <Route 
        path="/all-status" 
        element={
          <ProtectedRoute permissions={['release_versions_view']}>
            <Layout>
              <ReleaseVersionTab />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/release-trends" 
        element={
          <ProtectedRoute permissions={['release_trends_view']}>
            <Layout>
              <ReleaseTrendsPage />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/release-analysis" 
        element={
          <ProtectedRoute permissions={['release_trends_view']}>
            <Layout>
              <ReleaseAnalysisPage />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/release-setup" 
        element={
          <ProtectedRoute permissions={['release_setup_manage']}>
            <Layout>
              <ReleaseSetup />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/release-config" 
        element={
          <ProtectedRoute permissions={['release_config_manage']}>
            <Layout>
              <ReleaseConfigPage />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/generic-emailer" 
        element={
          <ProtectedRoute permissions={['email_send_generic']}>
            <Layout>
              <GenericEmailer />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/email-history" 
        element={
          <ProtectedRoute permissions={['email_history_view']}>
            <Layout>
              <EmailHistoryTab />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/sprint-report" 
        element={
          <ProtectedRoute permissions={['sprint_reports_view']}>
            <Layout>
              <SprintReportPage />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/kpis" 
        element={
          <ProtectedRoute permissions={['kpi_view']}>
            <Layout>
              <KPIPage />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
      <Route 
        path="/admin" 
        element={
          <ProtectedRoute permissions={['admin_panel_access']}>
            <Layout>
              <AdminPanel />
            </Layout>
          </ProtectedRoute>
        } 
      />
      
        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </TeamProvider>
  );
};

// Root app router with auto-login loading state
const AppRouter = () => {
  const { isAuthenticated, loading } = useAuth();

  // Show loading spinner while attempting auto-login
  if (loading) {
    return (
      <div className="app-loading">
        <div className="loading-content">
          <div className="loading-spinner">⏳</div>
          <h2>NDB Status Update Sender</h2>
          <p>Checking your session...</p>
        </div>
        
        <style>{`
          .app-loading {
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
          }
          
          .loading-content {
            text-align: center;
            max-width: 400px;
            padding: 48px;
          }
          
          .loading-spinner {
            font-size: 48px;
            margin-bottom: 24px;
            animation: pulse 2s ease-in-out infinite;
          }
          
          .loading-content h2 {
            margin: 0 0 16px 0;
            font-size: 24px;
            font-weight: 600;
          }
          
          .loading-content p {
            margin: 0;
            opacity: 0.9;
            font-size: 16px;
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 1; transform: scale(1); }
            50% { opacity: 0.7; transform: scale(1.1); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <Routes>
      <Route 
        path="/login" 
        element={
          !isAuthenticated ? (
            <LoginPage />
          ) : (
            <Navigate to="/" replace />
          )
        } 
      />
      
      <Route 
        path="/*" 
        element={
          isAuthenticated ? (
            <AuthenticatedApp />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />
    </Routes>
  );
};

// Main App component
function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <AppRouter />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './auth/context/AuthContext';
import { TeamProvider } from './contexts/TeamContext';
import { SelectedReleaseProvider } from './contexts/SelectedReleaseContext';
import { ReleaseDataProvider } from './contexts/ReleaseDataContext';
import { ProtectedRoute } from './auth/components/ProtectedRoute';
import { LoginForm } from './auth/components/LoginForm';
import { Layout } from './layout/components/Layout';
import { ErrorBoundary } from './shared/components/ErrorBoundary';
import { useAuth } from './auth/hooks/useAuth';

// Import existing components (these will be gradually migrated to the new modules)
import EmailSender from './components/EmailSender';
import ProjectStatusPage from './components/ProjectStatusPage';
import ReleaseSetup from './components/ReleaseSetup';
import ReleaseConfigPage from './components/ReleaseConfigPage';
import GenericEmailer from './components/GenericEmailer';
import EmailHistoryTab from './components/EmailHistoryTab';
import SprintReportPage from './components/SprintReportPage';
import SprintPerformancePage from './components/SprintPerformancePage';
import KPIPage from './components/KPIPage';
import SystemTestScalePage from './components/SystemTestScalePage';
import OncallsV2Page from './components/OncallsV2/OncallsV2Page';
import CfdCfiPage from './components/CfdCfiPage';
import CfdCfiV2Page from './components/CfdCfiV2/CfdCfiV2Page';
import DeferredInsightsPage from './components/DeferredInsights/DeferredInsightsPage';
import AdminPanel from './components/AdminPanel/AdminPanel';
import ConfigManager from './components/ConfigManager/ConfigManager';
import DesignSystemDemo from './design-system/DesignSystemDemo';
import ReleaseBriefPage from './release/ReleaseBriefPage';
import WeeklySkimPage from './release/WeeklySkimPage';
import RetrospectivePage from './release/RetrospectivePage';
import ChatbotPage from './release/ChatbotPage';
import FeatureDashboardPage from './feature/FeatureDashboardPage';
import { ComponentReport } from './components/ComponentReport';
import SosSummaryPage from './components/SosSummaryPage';
import SosLeaderSummaryPage from './components/SosLeaderSummaryPage';
import DependencyViewPage from './components/DependencyViewPage';
import ReleaseOutstandingWorkPage from './components/ReleaseOutstandingWorkPage';
import TeamOverallReportPage from './components/TeamOverallReportPage';
import SchedulePage from './components/SchedulePage';
import TpmPulsePage from './components/tpm/TpmPulsePage';
import JqlBuilder from './components/tpm/JqlBuilder';

import { ensureLoaded as ensureFieldConfigLoaded } from './utils/fieldConfig';
import './design-system/tokens.css';
import './design-system/primitives.css';
import './App.css';

// Team configuration is now handled by TeamProvider context

// Login page component
const LoginPage = () => {
  return (
    <div className="login-page">
      <div className="login-container">
        <div className="login-header">
          <h1>Nutanix Lighthouse</h1>
          <p>Sign in with your JIRA API token</p>
        </div>
        <LoginForm 
          onSuccess={() => {
            // Navigation will be handled by the auth state change
          }}
          className="login-form"
        />
      </div>
      
    </div>
  );
};

// Main authenticated app component
const AuthenticatedApp = () => {
  return (
    <TeamProvider>
      <SelectedReleaseProvider>
      <Routes>
        <Route 
          path="/login" 
          element={<Navigate to="/" replace />} 
        />
        
        {/* All routes wrapped in ReleaseDataProvider */}
        <Route 
          path="/*" 
          element={
            <ReleaseDataProvider>
              <Routes>
                <Route 
                  path="/" 
                  element={
                    <Layout>
                      <EmailSender />
                    </Layout>
                  } 
                />
                
                <Route
                  path="/project-status"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout fluid>
                        <ProjectStatusPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                {/* Back-compat: old /all-status URLs (bookmarks, emails) redirect to /project-status */}
                <Route path="/all-status" element={<Navigate to="/project-status" replace />} />
                
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
                  path="/sprint-performance" 
                  element={
                    <ProtectedRoute permissions={['sprint_reports_view']}>
                      <Layout>
                        <SprintPerformancePage />
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
                  path="/system-test-scale"
                  element={
                    <ProtectedRoute permissions={['kpi_view']}>
                      <Layout wide>
                        <SystemTestScalePage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/oncalls"
                  element={
                    <ProtectedRoute permissions={['kpi_view']}>
                      <Layout wide>
                        <OncallsV2Page />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                {/* Legacy /oncalls-legacy now redirects to canonical /oncalls (V2) */}
                <Route path="/oncalls-legacy" element={<Navigate to="/oncalls" replace />} />

                <Route
                  path="/cfdcfi"
                  element={
                    <ProtectedRoute permissions={['kpi_view']}>
                      <Layout wide>
                        <CfdCfiV2Page />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/cfdcfi-legacy"
                  element={
                    <ProtectedRoute permissions={['kpi_view']}>
                      <Layout wide>
                        <CfdCfiPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/deferred-insights"
                  element={
                    <ProtectedRoute permissions={[]}>
                      <Layout wide>
                        <DeferredInsightsPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/dependency-view"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout wide>
                        <DependencyViewPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/release-outstanding-work"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout wide>
                        <ReleaseOutstandingWorkPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/team-overall-report"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout wide>
                        <TeamOverallReportPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route path="/overall-team-report" element={<Navigate to="/team-overall-report" replace />} />
                <Route path="/team-overall" element={<Navigate to="/team-overall-report" replace />} />
                <Route
                  path="/deferral-workbench"
                  element={<Navigate to="/release-outstanding-work" replace />}
                />

                <Route
                  path="/team-management"
                  element={
                    <ProtectedRoute permissions={['admin_panel_access']}>
                      <Layout>
                        <AdminPanel />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route path="/admin" element={<Navigate to="/team-management" replace />} />
                <Route
                  path="/admin/config"
                  element={
                    <ProtectedRoute permissions={['admin_panel_access']}>
                      <Layout>
                        <ConfigManager />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                
                <Route
                  path="/design"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <DesignSystemDemo />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/release/brief"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <ReleaseBriefPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/release/weekly-skim"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <WeeklySkimPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/release/:name/brief"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <ReleaseBriefPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/release/retrospective"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <RetrospectivePage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/feature-dashboard"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <FeatureDashboardPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/component-report"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <ComponentReport />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route path="/sync-hub" element={<Navigate to="/project-status" replace />} />

                <Route
                  path="/sos-summary"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout wide>
                        <SosSummaryPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/sos-leader-summary"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout wide>
                        <SosLeaderSummaryPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/chatbot"
                  element={
                    <ProtectedRoute permissions={['ai_insights_view']}>
                      <Layout>
                        <ChatbotPage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/schedules"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <SchedulePage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />

                <Route
                  path="/tpm/pulse"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <TpmPulsePage />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/tpm/jql-builder"
                  element={
                    <ProtectedRoute permissions={['release_versions_view']}>
                      <Layout>
                        <JqlBuilder />
                      </Layout>
                    </ProtectedRoute>
                  }
                />
                <Route path="/tpm" element={<Navigate to="/tpm/pulse" replace />} />

                {/* Catch-all redirect */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </ReleaseDataProvider>
          }
        />
      </Routes>
      </SelectedReleaseProvider>
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
          <div className="loading-spinner" role="status" aria-label="Checking your session" />
          <h2>Nutanix Lighthouse</h2>
          <p>Checking your session...</p>
        </div>
        
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
  React.useEffect(() => { ensureFieldConfigLoaded(); }, []);
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
import '@livekit/components-styles';
import './styles.css';
import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from './components/AppShell';
import { RequireAuth } from './components/RequireAuth';
import { AuditLogPage } from './pages/AuditLog';
import { BillingPage } from './pages/Billing';
import { DashboardPage } from './pages/Dashboard';
import { HomeRedirect } from './pages/HomeRedirect';
import { InvitePage } from './pages/Invite';
import { LandingPage } from './pages/Landing';
import { LoginPage, SignupPage } from './pages/Auth';
import { SettingsPage } from './pages/Settings';
import { TeamPage } from './pages/Team';
import { SessionProvider } from './session';

// The video room pulls in the media SDK, so load it only when someone opens a meeting.
const MeetingPage = lazy(() => import('./pages/Meeting').then((m) => ({ default: m.MeetingPage })));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SessionProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/m/:code" element={<Suspense fallback={<div className="auth-wrap muted">Loading…</div>}><MeetingPage /></Suspense>} />
          <Route path="/app" element={<RequireAuth><HomeRedirect /></RequireAuth>} />
          <Route path="/app/:orgId" element={<RequireAuth><AppShell /></RequireAuth>}>
            <Route index element={<DashboardPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="billing" element={<BillingPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="audit" element={<AuditLogPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </SessionProvider>
  </StrictMode>,
);

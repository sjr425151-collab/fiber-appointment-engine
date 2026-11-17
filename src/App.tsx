import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { Spinner } from './components/ui';

// Every page is its own chunk, so a visitor only downloads the one they open.
const Privacy = lazy(() => import('./pages/Privacy'));
const AdminLogin = lazy(() => import('./pages/admin/Login'));
const AdminLayout = lazy(() => import('./pages/admin/Layout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const LeadDetail = lazy(() => import('./pages/admin/LeadDetail'));
const Appointments = lazy(() => import('./pages/admin/Appointments'));
const AdminBenchmarks = lazy(() => import('./pages/admin/Benchmarks'));
const AdminSettings = lazy(() => import('./pages/admin/Settings'));
const AdminLeads = lazy(() => import('./pages/admin/Dashboard').then((m) => ({ default: m.Leads })));
const PlatformApp = lazy(() => import('./platform/PlatformApp'));
const AdminAssessments = lazy(() => import('./pages/admin/Assessments'));
const AdminOpportunities = lazy(() => import('./pages/admin/Opportunities'));
const AdminReps = lazy(() => import('./pages/admin/Reps'));
const AdminChats = lazy(() => import('./pages/admin/Chats'));

function ScrollReset() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Block body on purpose: scrollTo() returns a Promise in newer browsers, and
    // an effect must not return anything but a cleanup function.
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

const fallback = (
  <div className="grid min-h-screen place-items-center text-slate-500">
    <Spinner className="h-8 w-8" />
  </div>
);

export default function App() {
  return (
    <Suspense fallback={fallback}>
      <ScrollReset />
      <Routes>
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="leads" element={<AdminLeads />} />
          <Route path="benchmarks" element={<AdminBenchmarks />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="assessments" element={<AdminAssessments />} />
          <Route path="opportunities" element={<AdminOpportunities />} />
          <Route path="reps" element={<AdminReps />} />
          <Route path="chats" element={<AdminChats />} />
        </Route>
        {/* Tucker: home at the root, the savings preview under /savings, and the not-found page. */}
        <Route path="/*" element={<PlatformApp />} />
      </Routes>
    </Suspense>
  );
}

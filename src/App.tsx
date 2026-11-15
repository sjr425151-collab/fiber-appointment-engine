import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import Landing from './pages/Landing';
import { Spinner } from './components/ui';

// Admin and secondary pages are split out so visitors only download the landing page.
const Privacy = lazy(() => import('./pages/Privacy'));
const AdminLogin = lazy(() => import('./pages/admin/Login'));
const AdminLayout = lazy(() => import('./pages/admin/Layout'));
const Dashboard = lazy(() => import('./pages/admin/Dashboard'));
const LeadDetail = lazy(() => import('./pages/admin/LeadDetail'));
const Appointments = lazy(() => import('./pages/admin/Appointments'));
const ServiceAreas = lazy(() => import('./pages/admin/ServiceAreas'));
const Locations = lazy(() => import('./pages/admin/Locations'));

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
  <div className="grid min-h-screen place-items-center text-slate-400">
    <Spinner className="h-8 w-8" />
  </div>
);

export default function App() {
  return (
    <Suspense fallback={fallback}>
      <ScrollReset />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="leads/:id" element={<LeadDetail />} />
          <Route path="appointments" element={<Appointments />} />
          <Route path="areas" element={<ServiceAreas />} />
          <Route path="locations" element={<Locations />} />
        </Route>
        <Route path="/:market" element={<Landing />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    </Suspense>
  );
}

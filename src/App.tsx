import { Route, Routes } from 'react-router-dom';
import Landing from './pages/Landing';
import AdminLogin from './pages/admin/Login';
import AdminLayout from './pages/admin/Layout';
import Dashboard from './pages/admin/Dashboard';
import LeadDetail from './pages/admin/LeadDetail';
import Appointments from './pages/admin/Appointments';
import ServiceAreas from './pages/admin/ServiceAreas';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/admin/login" element={<AdminLogin />} />
      <Route path="/admin" element={<AdminLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="leads/:id" element={<LeadDetail />} />
        <Route path="appointments" element={<Appointments />} />
        <Route path="areas" element={<ServiceAreas />} />
      </Route>
      <Route path="*" element={<Landing />} />
    </Routes>
  );
}

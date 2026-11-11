import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { Layout } from './components/Layout';
import { DialogProvider } from './components/kit';
import { Loading } from './components/ui';
import LoginPage from './pages/Login';
import DashboardPage from './pages/Dashboard';
import AthletesPage from './pages/Athletes';
import AthleteProfilePage from './pages/AthleteProfile';
import GroupsPage from './pages/Groups';
import GroupCardPage from './pages/GroupCard';
import CoachesPage from './pages/Coaches';
import PlansPage from './pages/Plans';
import SubscriptionsPage from './pages/Subscriptions';
import { BranchesPage, SportsPage } from './pages/Reference';
import StaffPage from './pages/Staff';
import SettingsPage from './pages/Settings';
import PlatformPage from './pages/Platform';
import AttendancePage, { AttendanceSheetPage } from './pages/Attendance';
import { CashPage, DebtorsPage, ExpensesPage, PaymentsPage } from './pages/Finance';
import PayrollPage from './pages/Payroll';
import ReportsPage from './pages/Reports';
import CommunicationPage from './pages/Communication';
import ImportPage from './pages/Import';
import AccountPage from './pages/Account';

function App() {
  const { me, loading } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <LoginPage />;
  const home = me.club ? '/dashboard' : me.user.isSuperadmin ? '/platform' : '/no-club';
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Navigate to={home} replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/athletes" element={<AthletesPage />} />
        <Route path="/athletes/:id" element={<AthleteProfilePage />} />
        <Route path="/groups" element={<GroupsPage />} />
        <Route path="/groups/:id" element={<GroupCardPage />} />
        <Route path="/coaches" element={<CoachesPage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/subscriptions" element={<SubscriptionsPage />} />
        <Route path="/branches" element={<BranchesPage />} />
        <Route path="/sports" element={<SportsPage />} />
        <Route path="/staff" element={<StaffPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/platform" element={<PlatformPage />} />
        <Route path="/attendance" element={<AttendancePage />} />
        <Route path="/attendance/:id" element={<AttendanceSheetPage />} />
        <Route path="/finance/debtors" element={<DebtorsPage />} />
        <Route path="/finance/payments" element={<PaymentsPage />} />
        <Route path="/finance/cash" element={<CashPage />} />
        <Route path="/finance/expenses" element={<ExpensesPage />} />
        <Route path="/payroll" element={<PayrollPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/communication" element={<CommunicationPage />} />
        <Route path="/import" element={<ImportPage />} />
        <Route path="/account" element={<AccountPage />} />
        <Route path="/no-club" element={<div className="pad">Sizga hech qanday klub biriktirilmagan.</div>} />
        <Route path="*" element={<div className="pad">Sahifa topilmadi.</div>} />
      </Routes>
    </Layout>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <DialogProvider>
          <App />
        </DialogProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);

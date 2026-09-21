import { Routes, Route } from 'react-router-dom';
import { Box, CircularProgress } from '@mui/material';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Investments from './pages/Investments';
import Loans from './pages/Loans';
import Budget from './pages/Budget';
import Users from './pages/Users';
import Login from './pages/Login';
import { useSession } from './hooks/useSession';

export default function App() {
  const { session, loading, refetch } = useSession();

  // Don't flash the login screen while the session is still being checked.
  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: 'background.default',
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  // The real protection is server-side: every /api route rejects
  // unauthenticated requests. This just avoids rendering a shell whose data
  // calls would all fail.
  if (!session) {
    return <Login onSignedIn={refetch} />;
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      <Sidebar user={session.user} />
      <Box component="main" sx={{ flexGrow: 1, p: 3, overflow: 'auto' }}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/accounts" element={<Accounts />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/investments" element={<Investments />} />
          <Route path="/loans" element={<Loans />} />
          <Route path="/budget" element={<Budget />} />
          <Route path="/users" element={<Users />} />
        </Routes>
      </Box>
    </Box>
  );
}

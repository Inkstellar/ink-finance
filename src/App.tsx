import { useState } from 'react';
import {
  Box,
  CircularProgress,
  AppBar,
  Toolbar,
  IconButton,
  Typography,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import { Routes, Route } from 'react-router-dom';
import Sidebar, { MobileDrawer } from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Calendar from './pages/Calendar';
import Accounts from './pages/Accounts';
import Transactions from './pages/Transactions';
import Investments from './pages/Investments';
import Loans from './pages/Loans';
import Budget from './pages/Budget';
import Wishlist from './pages/Wishlist';
import Users from './pages/Users';
import Login from './pages/Login';
import OfflineBanner from './components/OfflineBanner';
import { useSession } from './hooks/useSession';

const DRAWER_WIDTH = 260;

export default function App() {
  const { session, loading, refetch } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleMobileClose = () => setMobileOpen(false);
  const handleMobileOpen = () => setMobileOpen(true);

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
      {/* Desktop sidebar */}
      <Sidebar user={session.user} />

      {/* Mobile drawer */}
      <MobileDrawer
        user={session.user}
        open={mobileOpen}
        onClose={handleMobileClose}
      />

      {/* Main content */}
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          flexDirection: 'column',
          width: { xs: '100%', md: `calc(100% - ${DRAWER_WIDTH}px)` },
        }}
      >
        {/* Mobile top bar */}
        <AppBar
          position="static"
          sx={{
            display: { xs: 'flex', md: 'none' },
            bgcolor: 'background.paper',
            color: 'text.primary',
            borderBottom: '1px solid',
            borderColor: 'divider',
          }}
        >
          <Toolbar>
            <IconButton
              size="large"
              edge="start"
              color="inherit"
              aria-label="menu"
              onClick={handleMobileOpen}
              sx={{ mr: 2 }}
            >
              <MenuIcon />
            </IconButton>
            <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
              Ink Finance
            </Typography>
          </Toolbar>
        </AppBar>

        {/* Installed as a PWA the shell comes from the cache, so this is the
            only thing that tells the user the numbers behind it did not. */}
        <OfflineBanner />

        {/* Page content */}
        <Box component="main" sx={{ flexGrow: 1, p: 3, overflow: 'auto' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/accounts" element={<Accounts />} />
            <Route path="/transactions" element={<Transactions />} />
            <Route path="/investments" element={<Investments />} />
            <Route path="/loans" element={<Loans />} />
            <Route path="/budget" element={<Budget />} />
            <Route path="/wishlist" element={<Wishlist />} />
            <Route path="/users" element={<Users />} />
          </Routes>
        </Box>
      </Box>
    </Box>
  );
}

import { Drawer, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Box, Typography, Divider, Avatar, Button, Stack } from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ReceiptIcon from '@mui/icons-material/Receipt';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import BudgetIcon from '@mui/icons-material/PieChart';
import PeopleIcon from '@mui/icons-material/People';
import LogoutIcon from '@mui/icons-material/Logout';
import { signOut, type SessionUser } from '../lib/auth';

const drawerWidth = 240;

const navItems = [
  { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
  { label: 'Accounts', path: '/accounts', icon: <AccountBalanceWalletIcon /> },
  { label: 'Transactions', path: '/transactions', icon: <ReceiptIcon /> },
  { label: 'Investments', path: '/investments', icon: <TrendingUpIcon /> },
  { label: 'Loans', path: '/loans', icon: <AccountBalanceIcon /> },
  { label: 'Budget', path: '/budget', icon: <BudgetIcon /> },
  { label: 'Users', path: '/users', icon: <PeopleIcon /> },
];

export default function Sidebar({ user }: { user?: SessionUser }) {
  const location = useLocation();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
      }}
    >
      <Toolbar sx={{ px: 2.5, py: 2 }}>
        <Typography variant="h6" fontWeight={700} color="primary">
          Ink Finance
        </Typography>
      </Toolbar>
      <Divider />
      <List sx={{ px: 1 }}>
        {navItems.map((item) => {
          const active = location.pathname === item.path;
          return (
            <ListItemButton
              key={item.path}
              component={Link}
              to={item.path}
              selected={active}
              sx={{
                borderRadius: 2,
                mb: 0.5,
                '&.Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'white',
                  '&:hover': { bgcolor: 'primary.dark' },
                  '& .MuiListItemIcon-root': { color: 'white' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 36 }}>{item.icon}</ListItemIcon>
              <ListItemText primary={item.label} />
            </ListItemButton>
          );
        })}
      </List>
      <Box sx={{ mt: 'auto', p: 2 }}>
        {user && (
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
            <Avatar
              sx={{
                width: 32, height: 32, fontSize: 13, fontWeight: 700,
                bgcolor: user.image || 'primary.main',
              }}
            >
              {user.initials || (user.name ?? 'U').slice(0, 1).toUpperCase()}
            </Avatar>
            <Box sx={{ minWidth: 0 }}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {user.name}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap display="block">
                {user.email}
              </Typography>
            </Box>
          </Stack>
        )}
        <Button
          size="small"
          fullWidth
          color="inherit"
          startIcon={<LogoutIcon fontSize="small" />}
          onClick={() => signOut()}
          sx={{ justifyContent: 'flex-start', mb: 1 }}
        >
          Sign out
        </Button>
        <Typography variant="caption" color="text.secondary">
          v0.1.0 · Personal Finance
        </Typography>
      </Box>
    </Drawer>
  );
}

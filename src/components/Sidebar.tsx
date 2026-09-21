import {
  Drawer,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Box,
  Typography,
  Divider,
  Avatar,
  Button,
  Stack,
  Tooltip,
  Badge,
} from '@mui/material';
import { Link, useLocation } from 'react-router-dom';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ReceiptIcon from '@mui/icons-material/Receipt';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PieChartIcon from '@mui/icons-material/PieChart';
import PeopleIcon from '@mui/icons-material/People';
import LogoutIcon from '@mui/icons-material/Logout';
import FinanceIcon from '@mui/icons-material/AccountBalance';
import { signOut, type SessionUser } from '../lib/auth';

const drawerWidth = 260;

const navGroups = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
    ],
  },
  {
    title: 'Transactions',
    items: [
      { label: 'All Transactions', path: '/transactions', icon: <ReceiptIcon /> },
      { label: 'Accounts', path: '/accounts', icon: <AccountBalanceWalletIcon /> },
      { label: 'Investments', path: '/investments', icon: <TrendingUpIcon /> },
      { label: 'Loans', path: '/loans', icon: <AccountBalanceIcon /> },
      { label: 'Budget', path: '/budget', icon: <PieChartIcon /> },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Users', path: '/users', icon: <PeopleIcon /> },
    ],
  },
];

export default function Sidebar({ user }: { user?: SessionUser }) {
  const location = useLocation();

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: drawerWidth,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: drawerWidth,
          boxSizing: 'border-box',
          borderRight: '1px solid',
          borderColor: 'divider',
          backgroundImage: 'none',
        },
      }}
    >
      {/* Header */}
      <Toolbar
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
        }}
      >
        <Stack direction="row" alignItems="center" spacing={1.5}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1.5,
              bgcolor: 'rgba(255,255,255,0.2)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <FinanceIcon sx={{ fontSize: 22, color: 'white' }} />
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
              Ink Finance
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.8 }}>
              Personal Manager
            </Typography>
          </Box>
        </Stack>
      </Toolbar>

      {/* Navigation */}
      <Box sx={{ overflow: 'auto', flexGrow: 1, py: 1.5 }}>
        {navGroups.map((group) => (
          <Box key={group.title} sx={{ mb: 0.5 }}>
            <Typography
              variant="caption"
              sx={{
                px: 2.5,
                py: 1,
                color: 'text.secondary',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {group.title}
            </Typography>
            <List disablePadding>
              {group.items.map((item) => {
                const active = location.pathname === item.path;
                return (
                  <Tooltip title={item.label} placement="right" arrow key={item.path}>
                    <ListItemButton
                      component={Link}
                      to={item.path}
                      selected={active}
                      sx={{
                        mx: 1,
                        mb: 0.25,
                        borderRadius: 2,
                        px: 2,
                        minHeight: 48,
                        ...(active && {
                          bgcolor: 'primary.main',
                          color: 'white',
                          '& .MuiListItemIcon-root': { color: 'white' },
                        }),
                        '&:hover': {
                          ...(active
                            ? { bgcolor: 'primary.dark' }
                            : { bgcolor: 'action.hover' }),
                        },
                        transition: 'all 0.2s ease',
                      }}
                    >
                      <ListItemIcon
                        sx={{
                          minWidth: 40,
                          color: active ? 'white' : 'inherit',
                        }}
                      >
                        {item.icon}
                      </ListItemIcon>
                      <ListItemText
                        primary={item.label}
                        primaryTypographyProps={{
                          fontWeight: active ? 600 : 400,
                          fontSize: '0.875rem',
                        }}
                      />
                    </ListItemButton>
                  </Tooltip>
                );
              })}
            </List>
          </Box>
        ))}
      </Box>

      {/* User Profile */}
      <Divider />
      <Box
        sx={{
          p: 2,
          borderTop: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
        }}
      >
        {user && (
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1.5 }}>
            <Badge
              overlap="circular"
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              variant="dot"
              sx={{
                '& .MuiBadge-badge': {
                  bgcolor: 'success.main',
                  border: '2px solid',
                  borderColor: 'background.paper',
                },
              }}
            >
              <Avatar
                sx={{
                  width: 40,
                  height: 40,
                  fontSize: 15,
                  fontWeight: 700,
                  bgcolor: user.image || 'primary.main',
                  border: '2px solid',
                  borderColor: 'divider',
                }}
              >
                {user.initials || (user.name ?? 'U').slice(0, 1).toUpperCase()}
              </Avatar>
            </Badge>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {user.name}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                display="block"
              >
                {user.email}
              </Typography>
            </Box>
          </Stack>
        )}
        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => signOut()}
          sx={{
            justifyContent: 'flex-start',
            borderRadius: 2,
            textTransform: 'none',
            fontWeight: 500,
            '&:hover': {
              bgcolor: 'error.lighter',
              borderColor: 'error.main',
            },
          }}
        >
          Sign out
        </Button>
      </Box>
    </Drawer>
  );
}

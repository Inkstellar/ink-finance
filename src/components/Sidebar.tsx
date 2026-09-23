import { useState, useEffect } from 'react';
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
  Button,
  Stack,
  Tooltip,
  Badge,
  Chip,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';
import { Link, useLocation } from 'react-router-dom';
import DashboardIcon from '@mui/icons-material/Dashboard';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ReceiptIcon from '@mui/icons-material/Receipt';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import PieChartIcon from '@mui/icons-material/PieChart';
import PeopleIcon from '@mui/icons-material/People';
import LogoutIcon from '@mui/icons-material/Logout';
import FavoriteIcon from '@mui/icons-material/Favorite';
import LabelIcon from '@mui/icons-material/Label';
import FinanceIcon from '@mui/icons-material/AccountBalance';
import UserAvatar, { AVATAR_CHANGED_EVENT, type AvatarUser } from './UserAvatar';
import InstallApp from './InstallApp';
import { useApi } from '../hooks/useApi';
import { signOut, type SessionUser } from '../lib/auth';

const DRAWER_WIDTH = 260;

const navGroups = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', path: '/', icon: <DashboardIcon /> },
      { label: 'Calendar', path: '/calendar', icon: <CalendarMonthIcon /> },
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
      { label: 'Wishlist', path: '/wishlist', icon: <FavoriteIcon /> },
    ],
  },
  {
    title: 'Management',
    items: [
      { label: 'Categories', path: '/categories', icon: <LabelIcon /> },
      { label: 'Users', path: '/users', icon: <PeopleIcon /> },
    ],
  },
];

interface SidebarContentProps {
  user?: SessionUser;
  onClose?: () => void;
}

function SidebarContent({ user, onClose }: SidebarContentProps) {
  const location = useLocation();
  // Api Health Status
  const [apiStatus, setApiStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    let isMounted = true;
    async function checkApi() {
      try {
        const res = await fetch('/api/health', { method: 'HEAD', cache: 'no-store' });
        if (isMounted) setApiStatus(res.ok ? 'online' : 'offline');
      } catch {
        if (isMounted) setApiStatus('offline');
      }
    }
    checkApi();
    const interval = setInterval(checkApi, 30000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // The session JWT carries the user id, name and initials — but deliberately
  // not the picture: a base64 image would blow past the ~4KB cookie limit. So
  // the avatar comes from its own small request, refreshed when one is changed.
  const { data: me, refetch: refetchMe } = useApi<AvatarUser>('/api/users/me');

  useEffect(() => {
    const onAvatarChanged = () => refetchMe();
    window.addEventListener(AVATAR_CHANGED_EVENT, onAvatarChanged);
    return () => window.removeEventListener(AVATAR_CHANGED_EVENT, onAvatarChanged);
  }, [refetchMe]);

  // Prefer the fetched record, but fall back to the session so the name and
  // initials still render if that request is slow or fails.
  const profileUser: AvatarUser = {
    id: me?.id ?? user?.id ?? 'me',
    name: me?.name ?? user?.name,
    initials: me?.initials ?? user?.initials,
    color: me?.color,
    hasAvatar: me?.hasAvatar,
    updatedAt: me?.updatedAt,
  };

  return (
    <>
      {/* Header */}
      <Toolbar
        sx={{
          px: 2,
          py: 1.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          color: 'white',
          display: 'flex',
          justifyContent: 'space-between',
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
        {onClose && (
          <Button
            onClick={onClose}
            sx={{ color: 'white', minWidth: 36, p: 0.5 }}
          >
            <CloseIcon />
          </Button>
        )}
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
                display: 'block',
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
                      onClick={onClose}
                      sx={{
                        mx: 1,
                        mb: 0.25,
                        borderRadius: '4px',
                        px: 2,
                        minHeight: 48,
                        ...(active && {
                          '&.Mui-selected': {
                            bgcolor: 'rgb(110 102 200)',
                            color: 'white',
                            '& .MuiListItemIcon-root': { color: 'white' },
                            '&:hover': { bgcolor: 'rgb(90 82 180)' },
                          },
                        }),
                        '&:hover': {
                          ...(active
                            ? { bgcolor: 'rgb(90 82 180)' }
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
              <UserAvatar
                user={profileUser}
                size={40}
                fontSize={15}
                sx={{
                  border: '2px solid',
                  borderColor: 'divider',
                }}
              />
            </Badge>
            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Typography variant="body2" fontWeight={600} noWrap>
                {profileUser.name}
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
        {/* Renders nothing once the app is installed or when the browser
            offers no way to install it. */}
        <InstallApp onNavigate={onClose} />
        
        <Box sx={{ mb: 2, px: 0.5 }}>
          {apiStatus === 'checking' ? (
            <Chip 
              size="small" 
              label="Checking API..." 
              variant="outlined" 
              sx={{ width: '100%', justifyContent: 'center', fontSize: '0.7rem' }} 
            />
          ) : apiStatus === 'online' ? (
            <Chip 
              size="small" 
              label="API Online" 
              color="success" 
              variant="outlined"
              sx={{ width: '100%', justifyContent: 'center', fontSize: '0.7rem' }} 
            />
          ) : (
            <Box sx={{ textAlign: 'center' }}>
              <Chip 
                size="small" 
                label="API Offline" 
                color="error" 
                variant="filled"
                sx={{ width: '100%', justifyContent: 'center', fontSize: '0.7rem', mb: 0.5 }} 
              />
              <a 
                href="https://Ink-finance-api.onrender.com" 
                target="_blank" 
                rel="noopener noreferrer"
                style={{ 
                  fontSize: '0.65rem', 
                  color: '#d32f2f', 
                  textDecoration: 'none', 
                  fontWeight: 600,
                }}
                onMouseOver={(e) => e.currentTarget.style.textDecoration = 'underline'}
                onMouseOut={(e) => e.currentTarget.style.textDecoration = 'none'}
              >
                Wake up API server →
              </a>
            </Box>
          )}
        </Box>

        <Button
          fullWidth
          variant="outlined"
          color="error"
          startIcon={<LogoutIcon />}
          onClick={() => {
            signOut();
            onClose?.();
          }}
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
    </>
  );
}

interface SidebarProps {
  user?: SessionUser;
}

export default function Sidebar({ user }: SidebarProps) {
  return (
    <Box
      sx={{
        display: { xs: 'none', md: 'block' },
        width: DRAWER_WIDTH,
        flexShrink: 0,
      }}
    >
      <Drawer
        variant="permanent"
        sx={{
          width: DRAWER_WIDTH,
          flexShrink: 0,
          '& .MuiDrawer-paper': {
            width: DRAWER_WIDTH,
            boxSizing: 'border-box',
            borderRight: '1px solid',
            borderColor: 'divider',
          },
        }}
      >
        <SidebarContent user={user} />
      </Drawer>
    </Box>
  );
}

export function MobileDrawer({ user, open, onClose }: { user?: SessionUser; open: boolean; onClose: () => void }) {
  return (
    <Drawer
      variant="temporary"
      open={open}
      onClose={onClose}
      ModalProps={{ keepMounted: true }}
      sx={{
        display: { xs: 'block', md: 'none' },
        '& .MuiDrawer-paper': {
          boxSizing: 'border-box',
          width: DRAWER_WIDTH,
          borderRight: '1px solid',
          borderColor: 'divider',
        },
      }}
    >
      <SidebarContent user={user} onClose={onClose} />
    </Drawer>
  );
}

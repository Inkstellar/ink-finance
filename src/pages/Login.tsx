import { useState, type FormEvent } from 'react';
import {
  Alert, Box, Button, CircularProgress, Paper, Stack, TextField, Typography,
} from '@mui/material';
import LockOutlinedIcon from '@mui/icons-material/LockOutlined';
import { signIn } from '../lib/auth';

/**
 * Sign-in screen. Replaces the whole app shell while there is no session —
 * see App.tsx. The API is the real gate: every `/api` route returns 401
 * without a session, so hiding the UI is convenience, not the protection.
 */
export default function Login({ onSignedIn }: { onSignedIn: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await signIn(email.trim(), password);
      if (result.ok) {
        onSignedIn();
      } else {
        setError(result.error);
        setPassword('');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Paper elevation={0} sx={{ p: 4, width: '100%', maxWidth: 400 }}>
        <Stack spacing={1} alignItems="center" sx={{ mb: 3 }}>
          <Box
            sx={{
              width: 44, height: 44, borderRadius: '50%', bgcolor: 'primary.main',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <LockOutlinedIcon sx={{ color: 'primary.contrastText' }} />
          </Box>
          <Typography variant="h5" fontWeight={700}>Ink Finance</Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in to view your finances
          </Typography>
        </Stack>

        <form onSubmit={handleSubmit}>
          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}

            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              fullWidth
              required
            />
            <TextField
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              fullWidth
              required
            />

            <Button
              type="submit"
              variant="contained"
              size="large"
              disabled={busy || !email || !password}
              startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>

            <Typography variant="caption" color="text.secondary" align="center">
              Set or reset a password with{' '}
              <code>npm run user:set-password</code>
            </Typography>
          </Stack>
        </form>
      </Paper>
    </Box>
  );
}

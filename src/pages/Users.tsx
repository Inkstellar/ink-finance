import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { useSession } from '../hooks/useSession';
import { apiPost, apiDelete, apiPut, ApiError } from '../lib/api';
import {
  Alert, Box, Typography, Card, CardContent, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, IconButton, Avatar, Chip, Stack, Tooltip
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import KeyIcon from '@mui/icons-material/VpnKey';
import { formatDate } from '../lib/format';

interface User {
  id: string; name: string; initials: string; color: string;
  telegramId?: string | null;
  email?: string | null;
  hasPassword?: boolean;
  createdAt?: string; updatedAt?: string;
}

const EMPTY_FORM = { name: '', initials: '', color: '#2563eb', telegramId: '', email: '' };

export default function Users() {
  const { data: users, loading, refetch } = useApi<User[]>('/api/users');
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  // Password dialog
  const [pwUser, setPwUser] = useState<User | null>(null);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwDone, setPwDone] = useState(false);

  const usr = users || [];
  const meId = session?.user?.id;
  const isSelf = (u: User) => Boolean(meId && u.id === meId);

  const openAdd = () => {
    setEditUser(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({
      name: u.name,
      initials: u.initials,
      color: u.color,
      telegramId: u.telegramId || '',
      email: u.email || '',
    });
    setFormError(null);
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) return;
    const payload = {
      name: form.name,
      initials: form.initials || form.name.slice(0, 1).toUpperCase(),
      color: form.color,
      telegramId: form.telegramId || null,
      email: form.email.trim().toLowerCase() || null,
    };
    try {
      if (editUser) await apiPut(`/api/users/${editUser.id}`, payload);
      else await apiPost('/api/users', payload);
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this user.');
    }
  };

  const openPassword = (u: User) => {
    setPwUser(u);
    setPw({ current: '', next: '', confirm: '' });
    setPwError(null);
    setPwDone(false);
  };

  const handlePassword = async () => {
    if (!pwUser) return;
    if (pw.next.length < 8) {
      setPwError('Password must be at least 8 characters.');
      return;
    }
    if (pw.next !== pw.confirm) {
      setPwError('The two passwords do not match.');
      return;
    }
    try {
      await apiPut(`/api/users/${pwUser.id}/password`, {
        password: pw.next,
        // Only required when changing your own password; the API enforces it.
        ...(isSelf(pwUser) ? { currentPassword: pw.current } : {}),
      });
      setPwDone(true);
      setPw({ current: '', next: '', confirm: '' });
      refetch();
    } catch (err) {
      setPwError(err instanceof ApiError ? err.message : 'Could not set the password.');
    }
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`Delete ${u.name}? Their transactions are kept but lose the user link.`)) return;
    try {
      await apiDelete(`/api/users/${u.id}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not delete this user.');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h3" fontWeight={700}>Users</Typography>
          <Typography variant="body2" color="text.secondary">
            A user with an email and password can sign in to this app.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
          Add User
        </Button>
      </Box>

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Name</TableCell>
              <TableCell>Initials</TableCell>
              <TableCell>Login</TableCell>
              <TableCell>Telegram ID</TableCell>
              <TableCell>Added</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7}>Loading...</TableCell></TableRow>
            ) : usr.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center">No users yet. Click "Add User" to get started.</TableCell></TableRow>
            ) : usr.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell>
                  <Avatar sx={{ width: 40, height: 40, bgcolor: u.color, fontSize: 18, fontWeight: 700 }}>
                    {u.initials}
                  </Avatar>
                </TableCell>
                <TableCell>
                  {u.name}
                  {isSelf(u) && (
                    <Chip label="you" size="small" sx={{ ml: 1, height: 18, fontSize: 10 }} />
                  )}
                </TableCell>
                <TableCell>
                  <Chip label={u.initials} size="small" sx={{ fontWeight: 700 }} />
                </TableCell>
                <TableCell>
                  {u.email ? (
                    <Box>
                      <Typography variant="body2">{u.email}</Typography>
                      {!u.hasPassword && (
                        <Typography variant="caption" color="warning.main">
                          no password set — cannot sign in
                        </Typography>
                      )}
                    </Box>
                  ) : (
                    <Chip label="No login" size="small" variant="outlined" />
                  )}
                </TableCell>
                <TableCell>{u.telegramId || '—'}</TableCell>
                <TableCell>
                  <Typography variant="caption" color="text.secondary">
                    {u.createdAt ? formatDate(u.createdAt) : '—'}
                  </Typography>
                </TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title={u.hasPassword ? 'Change password' : 'Set password'}>
                      <IconButton size="small" onClick={() => openPassword(u)}>
                        <KeyIcon fontSize="small" color={u.hasPassword ? 'inherit' : 'warning'} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Edit details">
                      <IconButton size="small" onClick={() => openEdit(u)}>
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    {!isSelf(u) && (
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => handleDelete(u)}>
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* ── Add / edit details ── */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editUser ? 'Edit User' : 'Add User'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              fullWidth
            />
            <TextField
              label="Initials"
              value={form.initials}
              onChange={(e) => setForm({ ...form, initials: e.target.value })}
              helperText="Displayed in avatar circle (e.g. K, P)"
            />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <TextField
                label="Color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                fullWidth
                InputProps={{
                  startAdornment: (
                    <Box sx={{ width: 24, height: 24, borderRadius: '50%', bgcolor: form.color, mr: 1, border: '1px solid rgba(0,0,0,0.1)' }} />
                  ),
                }}
              />
              <input
                type="color"
                value={form.color}
                onChange={(e) => setForm({ ...form, color: e.target.value })}
                style={{ width: 48, height: 40, border: 'none', cursor: 'pointer' }}
              />
            </Box>
            <TextField
              label="Email (for login)"
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              helperText="Leave blank for someone who should not sign in. Set the password with the key icon."
              fullWidth
            />
            <TextField
              label="Telegram ID (optional)"
              value={form.telegramId}
              onChange={(e) => setForm({ ...form, telegramId: e.target.value })}
              helperText="Link Telegram account for auto-assignment"
              fullWidth
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.name}>
            {editUser ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Password ── */}
      <Dialog open={Boolean(pwUser)} onClose={() => setPwUser(null)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {pwUser?.hasPassword ? 'Change password' : 'Set password'} — {pwUser?.name}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {pwDone && <Alert severity="success">Password updated.</Alert>}
            {pwError && <Alert severity="error">{pwError}</Alert>}

            {pwUser && !pwUser.email && (
              <Alert severity="warning">
                This user has no email yet, so the password can't be used until one is set.
              </Alert>
            )}

            {pwUser && isSelf(pwUser) && (
              <TextField
                label="Current password"
                type="password"
                value={pw.current}
                onChange={(e) => setPw({ ...pw, current: e.target.value })}
                autoComplete="current-password"
                fullWidth
              />
            )}
            {pwUser && !isSelf(pwUser) && (
              <Alert severity="info">
                You're setting the password for another user. They can change it once signed in.
              </Alert>
            )}

            <TextField
              label="New password"
              type="password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              helperText="At least 8 characters"
              autoComplete="new-password"
              fullWidth
            />
            <TextField
              label="Confirm new password"
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              autoComplete="new-password"
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPwUser(null)}>Close</Button>
          <Button variant="contained" onClick={handlePassword} disabled={!pw.next}>
            Save password
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

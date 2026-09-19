import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiPost, apiDelete, apiPut } from '../lib/api';
import {
  Box, Typography, Card, CardContent, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Table, TableBody, TableCell, TableContainer, TableHead,
  TableRow, Paper, IconButton, Avatar, Chip, Stack
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

interface User {
  id: string; name: string; initials: string; color: string; telegramId?: string | null;
  createdAt?: string; updatedAt?: string;
}

export default function Users() {
  const { data: users, loading, refetch } = useApi<User[]>('/api/users');
  const [open, setOpen] = useState(false);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [form, setForm] = useState({ name: '', initials: '', color: '#2563eb', telegramId: '' });

  const usr = users || [];

  const openAdd = () => {
    setEditUser(null);
    setForm({ name: '', initials: '', color: '#2563eb', telegramId: '' });
    setOpen(true);
  };

  const openEdit = (u: User) => {
    setEditUser(u);
    setForm({ name: u.name, initials: u.initials, color: u.color, telegramId: u.telegramId || '' });
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name) return;
    const payload = {
      name: form.name,
      initials: form.initials || form.name.slice(0, 1).toUpperCase(),
      color: form.color,
      telegramId: form.telegramId || null,
    };
    if (editUser) {
      await apiPut(`/api/users/${editUser.id}`, payload);
    } else {
      await apiPost('/api/users', payload);
    }
    setOpen(false);
    refetch();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this user? Transactions will keep but lose user link.')) return;
    await apiDelete(`/api/users/${id}`);
    refetch();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h3" fontWeight={700}>Users</Typography>
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
              <TableCell>Color</TableCell>
              <TableCell>Telegram ID</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}>Loading...</TableCell></TableRow>
            ) : usr.length === 0 ? (
              <TableRow><TableCell colSpan={6} align="center">No users yet. Click "Add User" to get started.</TableCell></TableRow>
            ) : usr.map((u) => (
              <TableRow key={u.id} hover>
                <TableCell>
                  <Avatar sx={{ width: 40, height: 40, bgcolor: u.color, fontSize: 18, fontWeight: 700 }}>
                    {u.initials}
                  </Avatar>
                </TableCell>
                <TableCell>{u.name}</TableCell>
                <TableCell>
                  <Chip label={u.initials} size="small" sx={{ fontWeight: 700 }} />
                </TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{ width: 20, height: 20, borderRadius: '50%', bgcolor: u.color, border: '1px solid rgba(0,0,0,0.1)' }} />
                    {u.color}
                  </Box>
                </TableCell>
                <TableCell>{u.telegramId || '—'}</TableCell>
                <TableCell>
                  <Stack direction="row" spacing={0.5}>
                    <IconButton size="small" onClick={() => openEdit(u)}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(u.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editUser ? 'Edit User' : 'Add User'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
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
    </Box>
  );
}

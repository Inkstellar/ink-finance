import { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiPost, apiPut, apiDelete, ApiError } from '../lib/api';
import { formatINR, formatINRDecimal } from '../lib/format';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, FormControl, Grid, IconButton, InputLabel, MenuItem, Paper, Select,
  Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Tooltip, Typography, Switch, FormControlLabel,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import SavingsIcon from '@mui/icons-material/Savings';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import StatCard from '../components/StatCard';
import { formatDate } from '../lib/format';

interface Account {
  id: string;
  name: string;
  type: string;
  balance: number;
  currency: string;
  notes?: string | null;
  archived: boolean;
  createdAt: string;
}

const ACCOUNT_TYPES = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
  { value: 'CASH', label: 'Cash' },
  { value: 'WALLET', label: 'Wallet' },
  { value: 'CREDIT_CARD', label: 'Credit Card' },
  { value: 'INVESTMENT', label: 'Investment' },
  { value: 'LOAN', label: 'Loan' },
];

/** Types whose balance represents money owed rather than money held. */
const LIABILITY_TYPES = new Set(['CREDIT_CARD', 'LOAN']);

const typeLabel = (t: string) => ACCOUNT_TYPES.find((x) => x.value === t)?.label ?? t;

const EMPTY_FORM = { name: '', type: 'CHECKING', balance: '0', notes: '' };

export default function Accounts() {
  const [showArchived, setShowArchived] = useState(false);
  const { data: accounts, loading, refetch } = useApi<Account[]>(
    showArchived ? '/api/accounts?includeArchived=true' : '/api/accounts',
  );

  const [open, setOpen] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const accts = accounts || [];

  const totals = useMemo(() => {
    const active = accts.filter((a) => !a.archived);
    const held = active.filter((a) => !LIABILITY_TYPES.has(a.type)).reduce((s, a) => s + a.balance, 0);
    const owed = active.filter((a) => LIABILITY_TYPES.has(a.type)).reduce((s, a) => s + a.balance, 0);
    return {
      activeCount: active.length,
      balance: active.reduce((s, a) => s + a.balance, 0),
      held,
      owed,
      archivedCount: accts.filter((a) => a.archived).length,
    };
  }, [accts]);

  const openAdd = () => {
    setEditAccount(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (a: Account) => {
    setEditAccount(a);
    setForm({
      name: a.name,
      type: a.type,
      balance: String(a.balance),
      notes: a.notes || '',
    });
    setFormError(null);
    setOpen(true);
  };

  const handleSubmit = async () => {
    if (!form.name.trim()) return;
    const balance = Number(form.balance);
    if (Number.isNaN(balance)) {
      setFormError('Balance must be a number.');
      return;
    }
    const payload = {
      name: form.name.trim(),
      type: form.type,
      balance,
      notes: form.notes.trim() || null,
    };
    try {
      if (editAccount) await apiPut(`/api/accounts/${editAccount.id}`, payload);
      else await apiPost('/api/accounts', payload);
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this account.');
    }
  };

  const setArchived = async (a: Account, archived: boolean) => {
    if (
      archived &&
      !confirm(
        `Archive "${a.name}"?\n\nIt will disappear from account pickers and the dashboard, but its transactions are kept and you can restore it later.`,
      )
    ) {
      return;
    }
    try {
      await apiPut(`/api/accounts/${a.id}`, { archived });
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not update this account.');
    }
  };

  const removeForever = async (a: Account) => {
    if (!confirm(`Permanently delete "${a.name}"? This cannot be undone.`)) return;
    try {
      // The API archives on DELETE; that is the safe default and there is no
      // hard-delete endpoint, so restoring stays possible.
      await apiDelete(`/api/accounts/${a.id}`);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not archive this account.');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Box>
          <Typography variant="h3" fontWeight={700}>Accounts</Typography>
          <Typography variant="body2" color="text.secondary">
            Where your money sits. Balances adjust automatically as you add transactions.
          </Typography>
        </Box>
        <Stack direction="row" spacing={2} alignItems="center">
          <FormControlLabel
            control={<Switch size="small" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />}
            label={<Typography variant="body2">Show archived</Typography>}
          />
          <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
            Add Account
          </Button>
        </Stack>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Balance"
            value={formatINR(totals.balance)}
            subtitle={`${totals.activeCount} active ${totals.activeCount === 1 ? 'account' : 'accounts'}`}
            color="success.main"
            icon={<AccountBalanceWalletIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Cash & Bank"
            value={formatINR(totals.held)}
            subtitle="Checking, savings, cash, wallet"
            color="primary.main"
            icon={<SavingsIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Owed"
            value={formatINR(totals.owed)}
            subtitle="Credit cards and loans"
            color={totals.owed > 0 ? 'error.main' : 'text.primary'}
            icon={<CreditCardIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
      </Grid>

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Account</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Currency</TableCell>
              <TableCell>Added</TableCell>
              <TableCell align="right">Balance</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6}>Loading...</TableCell></TableRow>
            ) : accts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} align="center">
                  No accounts yet. Click "Add Account" to create your first one.
                </TableCell>
              </TableRow>
            ) : (
              accts.map((a) => {
                const liability = LIABILITY_TYPES.has(a.type);
                return (
                  <TableRow key={a.id} hover sx={a.archived ? { opacity: 0.55 } : undefined}>
                    <TableCell>
                      <Typography variant="body2" fontWeight={600}>{a.name}</Typography>
                      {a.notes && (
                        <Typography variant="caption" color="text.secondary">{a.notes}</Typography>
                      )}
                    </TableCell>
                    <TableCell>
                      <Chip
                        label={typeLabel(a.type)}
                        size="small"
                        color={liability ? 'error' : 'default'}
                        variant={liability ? 'filled' : 'outlined'}
                      />
                    </TableCell>
                    <TableCell>{a.currency}</TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {a.createdAt ? formatDate(a.createdAt) : '—'}
                      </Typography>
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 600, color: liability && a.balance > 0 ? 'error.main' : 'text.primary' }}
                    >
                      {formatINRDecimal(a.balance)}
                    </TableCell>
                    <TableCell>
                      <Stack direction="row" spacing={0.5} justifyContent="flex-end">
                        {a.archived && <Chip label="archived" size="small" sx={{ height: 20, fontSize: 10 }} />}
                        <Tooltip title="Edit">
                          <IconButton size="small" onClick={() => openEdit(a)}>
                            <EditIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        {a.archived ? (
                          <Tooltip title="Restore">
                            <IconButton size="small" onClick={() => setArchived(a, false)}>
                              <UnarchiveIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        ) : (
                          <Tooltip title="Archive">
                            <IconButton size="small" onClick={() => removeForever(a)}>
                              <ArchiveIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        )}
                      </Stack>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {totals.archivedCount > 0 && !showArchived && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          {totals.archivedCount} archived {totals.archivedCount === 1 ? 'account is' : 'accounts are'} hidden.
        </Typography>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editAccount ? 'Edit Account' : 'Add Account'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}
            <TextField
              label="Name"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. HDFC Bank"
              autoFocus
              fullWidth
            />
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={form.type}
                label="Type"
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {ACCOUNT_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Balance"
              type="number"
              value={form.balance}
              onChange={(e) => setForm({ ...form, balance: e.target.value })}
              helperText="Transactions keep this in step. Edit it only to correct a mismatch — for credit cards and loans enter the amount owed."
              fullWidth
            />
            <TextField
              label="Notes (optional)"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              fullWidth
            />
            <Alert severity="info" icon={false}>
              <Typography variant="caption">
                All amounts are in INR — this app is single-currency by design.
              </Typography>
            </Alert>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.name.trim()}>
            {editAccount ? 'Save' : 'Create'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

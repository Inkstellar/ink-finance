import { useMemo, useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiPost, apiDelete, apiPut } from '../lib/api';
import { todayIST } from '../lib/format';
import {
  Box, Typography, Card, CardContent, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Select, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  IconButton, Avatar, Grid, Chip, Stack, Tooltip, InputAdornment, TableSortLabel
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import CloseIcon from '@mui/icons-material/Close';
import { formatINRDecimal, formatDate } from '../lib/format';

interface User {
  id: string; name: string; initials: string; color: string; telegramId?: string | null;
}
interface Account {
  id: string; name: string; type: string; balance: number;
}
interface Category {
  id: string; name: string; type: string; color: string;
}
interface Transaction {
  id: string; amount: number; type: string; date: string; description: string;
  notes?: string; accountId: string; categoryId?: string; userId?: string | null;
  account: Account; category?: Category; user?: User;
}

const TX_TYPES = [
  { value: 'INCOME', label: 'Income' },
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'TRANSFER', label: 'Transfer' },
  { value: 'INVESTMENT_BUY', label: 'Investment Buy' },
  { value: 'INVESTMENT_SELL', label: 'Investment Sell' },
  { value: 'LOAN_PAYMENT', label: 'Loan Payment' },
];

// Sortable column definitions — key must match sortValue below
type SortKey = 'user' | 'date' | 'description' | 'category' | 'account' | 'type' | 'amount';
const COLUMNS: { key: SortKey | 'actions'; label: string; align: 'left' | 'right'; sortable: boolean }[] = [
  { key: 'user', label: 'User', align: 'left', sortable: true },
  { key: 'date', label: 'Date', align: 'left', sortable: true },
  { key: 'description', label: 'Description', align: 'left', sortable: true },
  { key: 'category', label: 'Category', align: 'left', sortable: true },
  { key: 'account', label: 'Account', align: 'left', sortable: true },
  { key: 'type', label: 'Type', align: 'left', sortable: true },
  { key: 'amount', label: 'Amount', align: 'right', sortable: true },
  { key: 'actions', label: '', align: 'right', sortable: false },
];

export default function Transactions() {
  const { data: transactions, loading, refetch } = useApi<Transaction[]>('/api/transactions');
  const { data: accounts } = useApi<Account[]>('/api/accounts');
  const { data: categories } = useApi<Category[]>('/api/categories');
  const { data: users } = useApi<User[]>('/api/users');
  const [open, setOpen] = useState(false);
  const [filterUser, setFilterUser] = useState<string>('');
  const [search, setSearch] = useState('');
  const [orderBy, setOrderBy] = useState<SortKey>('date');
  const [order, setOrder] = useState<'asc' | 'desc'>('desc');
  const [form, setForm] = useState({
    amount: '', type: 'EXPENSE', date: todayIST(),
    description: '', notes: '', accountId: '', categoryId: '', userId: '',
  });

  const accts = accounts || [];
  const cats = categories || [];
  const usr = users || [];
  const getUser = (userId: string | null | undefined) => usr.find(u => u.id === userId);

  const handleSort = (key: SortKey) => {
    if (orderBy === key) {
      setOrder(order === 'asc' ? 'desc' : 'asc');
    } else {
      // sensible initial direction per column
      setOrderBy(key);
      setOrder(key === 'date' || key === 'amount' ? 'desc' : 'asc');
    }
  };

  // Resolve a comparable value for a transaction given the sort key
  const sortValue = (tx: Transaction, key: SortKey): string | number => {
    switch (key) {
      case 'user': return getUser(tx.userId)?.name ?? '';
      case 'date': return new Date(tx.date).getTime();
      case 'description': return tx.description.toLowerCase();
      case 'category': return tx.category?.name ?? '';
      case 'account': return tx.account?.name ?? '';
      case 'type': return tx.type;
      case 'amount': return tx.amount;
      default: return '';
    }
  };

  const txs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (transactions || [])
      .filter(t => !filterUser || t.userId === filterUser)
      .filter(t => {
        if (!q) return true;
        const hay = [
          t.description, t.notes, t.type,
          t.account?.name, t.category?.name,
          getUser(t.userId)?.name,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
      })
      .sort((a, b) => {
        const av = sortValue(a, orderBy);
        const bv = sortValue(b, orderBy);
        const cmp = typeof av === 'number' && typeof bv === 'number'
          ? av - bv
          : String(av).localeCompare(String(bv));
        return order === 'asc' ? cmp : -cmp;
      });
  }, [transactions, filterUser, search, orderBy, order, usr]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    await apiPost('/api/transactions', {
      ...form,
      amount: parseFloat(form.amount),
      accountId: form.accountId,
      categoryId: form.categoryId || undefined,
      userId: form.userId || null,
    });
    setOpen(false);
    setForm({
      amount: '', type: 'EXPENSE', date: todayIST(),
      description: '', notes: '', accountId: '', categoryId: '', userId: '',
    });
    refetch();
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/api/transactions/${id}`);
    refetch();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 2 }}>
        <Typography variant="h3" fontWeight={700}>Transactions</Typography>
        {!loading && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 2, fontWeight: 500 }}>
            {txs.length} of {(transactions || []).length} {search.trim() ? 'matching' : 'transactions'}
          </Typography>
        )}
        <Stack direction="row" spacing={1} alignItems="center">
          <TextField
            size="small"
            placeholder="Search transactions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: 260 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
              endAdornment: search && (
                <InputAdornment position="end">
                  <IconButton size="small" onClick={() => setSearch('')} aria-label="Clear search">
                    <CloseIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ),
            }}
          />
          {usr.length > 0 && (
            <FormControl sx={{ minWidth: 140 }} size="small">
              <InputLabel>Filter by user</InputLabel>
              <Select
                value={filterUser}
                label="Filter by user"
                onChange={(e) => setFilterUser(e.target.value)}
              >
                <MenuItem value=""><em>All</em></MenuItem>
                {usr.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
            Add Transaction
          </Button>
        </Stack>
      </Box>

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              {COLUMNS.map((col) => (
                <TableCell key={col.key} align={col.align} sortDirection={orderBy === col.key ? order : false}>
                  {col.sortable ? (
                    <TableSortLabel
                      active={orderBy === col.key}
                      direction={orderBy === col.key ? order : 'asc'}
                      onClick={() => handleSort(col.key as SortKey)}
                    >
                      {col.label}
                    </TableSortLabel>
                  ) : (
                    col.label
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8}>Loading...</TableCell></TableRow>
            ) : txs.length === 0 ? (
              (transactions || []).length > 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center">
                    No transactions match {search ? `"${search}"` : 'the current filters'}.
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow><TableCell colSpan={8} align="center">No transactions yet. Click "Add Transaction" to get started.</TableCell></TableRow>
              )
            ) : txs.map((tx) => {
              const user = getUser(tx.userId);
              return (
                <TableRow key={tx.id} hover>
                  <TableCell>
                    {user ? (
                      <Tooltip title={user.name}>
                        <Avatar sx={{ width: 28, height: 28, bgcolor: user.color, fontSize: 12, fontWeight: 700 }}>
                          {user.initials}
                        </Avatar>
                      </Tooltip>
                    ) : (
                      <Chip label="—" size="small" sx={{ height: 20, fontSize: 11 }} />
                    )}
                  </TableCell>
                  <TableCell>{formatDate(tx.date)}</TableCell>
                  <TableCell>{tx.description}</TableCell>
                  <TableCell>
                    {tx.category && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: tx.category.color }} />
                        {tx.category.name}
                      </Box>
                    )}
                  </TableCell>
                  <TableCell>{tx.account?.name}</TableCell>
                  <TableCell>
                    <Typography variant="caption" sx={{
                      px: 1, py: 0.5, borderRadius: 1,
                      bgcolor: tx.type === 'INCOME' ? 'success.light' :
                        tx.type === 'EXPENSE' ? 'error.light' : 'info.light',
                    }}>
                      {tx.type.replace(/_/g, ' ')}
                    </Typography>
                  </TableCell>
                  <TableCell align="right" sx={{
                    color: tx.type === 'INCOME' ? 'success.main' :
                      tx.type === 'EXPENSE' ? 'error.main' : 'text.primary',
                    fontWeight: 600,
                  }}>
                    {tx.type === 'INCOME' ? '+' : tx.type === 'EXPENSE' ? '-' : ''}
                    {formatINRDecimal(tx.amount)}
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => handleDelete(tx.id)}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Transaction</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>User</InputLabel>
              <Select
                value={form.userId}
                label="User"
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {usr.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.name} ({u.initials})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Type</InputLabel>
              <Select
                value={form.type}
                label="Type"
                onChange={(e) => setForm({ ...form, type: e.target.value })}
              >
                {TX_TYPES.map((t) => (
                  <MenuItem key={t.value} value={t.value}>{t.label}</MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              label="Amount"
              type="number"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
            <TextField
              label="Date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="Description"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
            <FormControl fullWidth>
              <InputLabel>Account</InputLabel>
              <Select
                value={form.accountId}
                label="Account"
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
              >
                {accts.map((a) => (
                  <MenuItem key={a.id} value={a.id}>{a.name} ({a.type})</MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select
                value={form.categoryId}
                label="Category"
                onChange={(e) => setForm({ ...form, categoryId: e.target.value })}
              >
                <MenuItem value=""><em>None</em></MenuItem>
                {cats.map((c) => (
                  <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.amount || !form.description || !form.accountId}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

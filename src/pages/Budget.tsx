import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiPost } from '../lib/api';
import {
  Box, Typography, Card, CardContent, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Select, FormControl, InputLabel,
  Grid, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  LinearProgress,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import { formatINR } from '../lib/format';

interface Category {
  id: string; name: string; type: string; color: string;
}
interface Budget {
  id: string; amount: number; month: number; year: number;
  category: Category;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export default function Budget() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: '', categoryId: '' });

  const { data: budgets, loading, refetch } = useApi<Budget[]>(`/api/budgets?month=${month}&year=${year}`);
  const { data: categories } = useApi<Category[]>('/api/categories');

  const allBudgets = budgets || [];
  const cats = categories || [];
  const expenseCategories = cats.filter(c => c.type === 'EXPENSE');
  const totalBudget = allBudgets.reduce((s, b) => s + b.amount, 0);

  const handleSubmit = async () => {
    await apiPost('/api/budgets', {
      amount: parseFloat(form.amount),
      month,
      year,
      categoryId: form.categoryId,
    });
    setOpen(false);
    setForm({ amount: '', categoryId: '' });
    refetch();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h3" fontWeight={700}>Budget</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Set Budget
        </Button>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, mb: 3 }}>
        <FormControl size="small" sx={{ minWidth: 150 }}>
          <InputLabel>Month</InputLabel>
          <Select value={month} label="Month" onChange={(e) => setMonth(e.target.value as number)}>
            {MONTHS.map((m, i) => <MenuItem key={i} value={i + 1}>{m}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 100 }}>
          <InputLabel>Year</InputLabel>
          <Select value={year} label="Year" onChange={(e) => setYear(e.target.value as number)}>
            {[now.getFullYear(), now.getFullYear() - 1, now.getFullYear() + 1].map(y =>
              <MenuItem key={y} value={y}>{y}</MenuItem>
            )}
          </Select>
        </FormControl>
      </Box>

      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" color="text.secondary">Total Monthly Budget</Typography>
          <Typography variant="h3" fontWeight={700} color="primary.main">
            {formatINR(totalBudget)}
          </Typography>
        </CardContent>
      </Card>

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Category</TableCell>
              <TableCell align="right">Budget</TableCell>
              <TableCell align="right">Spent</TableCell>
              <TableCell align="right">Remaining</TableCell>
              <TableCell sx={{ width: '20%' }}>Progress</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={5}>Loading...</TableCell></TableRow>
            ) : allBudgets.length === 0 ? (
              <TableRow><TableCell colSpan={5} align="center">No budgets set for {MONTHS[month - 1]} {year}. Click "Set Budget" to get started.</TableCell></TableRow>
            ) : allBudgets.map((b) => {
              // Spent amount would come from transactions — placeholder for now
              const spent = 0;
              const remaining = b.amount - spent;
              const progress = b.amount > 0 ? (spent / b.amount) * 100 : 0;
              return (
                <TableRow key={b.id} hover>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: b.category.color }} />
                      {b.category.name}
                    </Box>
                  </TableCell>
                  <TableCell align="right" fontWeight={600}>{formatINR(b.amount)}</TableCell>
                  <TableCell align="right" color="error.main">{formatINR(spent)}</TableCell>
                  <TableCell align="right" sx={{ color: remaining >= 0 ? 'success.main' : 'error.main' }}>
                    {formatINR(remaining)}
                  </TableCell>
                  <TableCell>
                    <LinearProgress
                      variant="determinate"
                      value={Math.min(progress, 100)}
                      color={progress > 90 ? 'error' : progress > 75 ? 'warning' : 'primary'}
                      sx={{ height: 8, borderRadius: 4 }}
                    />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Set Budget — {MONTHS[month - 1]} {year}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <FormControl fullWidth>
              <InputLabel>Category</InputLabel>
              <Select value={form.categoryId} label="Category" onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                {expenseCategories.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="Budget Amount" type="number" value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.amount || !form.categoryId}>Save</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

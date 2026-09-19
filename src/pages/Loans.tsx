import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiPost } from '../lib/api';
import {
  Box, Typography, Card, CardContent, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, Grid, Chip, Table, TableBody, TableCell,
  TableContainer, TableHead, TableRow, Paper, Collapse, IconButton
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { formatINR, formatINRDecimal, formatDate, formatPercent } from '../lib/format';
import StatCard from '../components/StatCard';
import HomeWorkIcon from '@mui/icons-material/HomeWork';

interface LoanPayment {
  id: string; amount: number; principal: number; interest: number; balance: number; paidOn: string;
}
interface Loan {
  id: string; name: string; lender?: string; principal: number;
  interestRate: number; tenureMonths: number; monthlyEmi: number;
  disbursedOn: string; endDate?: string | null; remainingPrincipal: number;
  status: string; payments: LoanPayment[];
}

function LoanRow({ loan }: { loan: Loan }) {
  const [open, setOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: String(loan.monthlyEmi), principal: '', interest: '', balance: '', paidOn: new Date().toISOString().slice(0, 10),
  });

  const handlePayment = async () => {
    await apiPost(`/api/loans/${loan.id}/payment`, {
      amount: parseFloat(payForm.amount),
      principal: parseFloat(payForm.principal || '0'),
      interest: parseFloat(payForm.interest || '0'),
      balance: parseFloat(payForm.balance || '0'),
      paidOn: payForm.paidOn,
    });
    setPayOpen(false);
    window.location.reload();
  };

  const paidAmount = loan.principal - loan.remainingPrincipal;
  const progressPct = loan.principal > 0 ? (paidAmount / loan.principal) * 100 : 0;
  const totalInterest = loan.payments.reduce((s, p) => s + p.interest, 0);
  const totalPaid = loan.payments.reduce((s, p) => s + p.amount, 0);

  return (
    <>
      <TableRow hover onClick={() => setOpen(!open)} sx={{ cursor: 'pointer' }}>
        <TableCell>
          <IconButton size="small">{open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}</IconButton>
        </TableCell>
        <TableCell><Typography fontWeight={600}>{loan.name}</Typography></TableCell>
        <TableCell>{loan.lender || '—'}</TableCell>
        <TableCell align="right">{formatINR(loan.principal)}</TableCell>
        <TableCell align="right">{formatINRDecimal(loan.monthlyEmi)}</TableCell>
        <TableCell align="right">{formatPercent(loan.interestRate)}</TableCell>
        <TableCell align="right">{formatINR(loan.remainingPrincipal)}</TableCell>
        <TableCell>
          <Chip
            label={loan.status}
            size="small"
            color={loan.status === 'ACTIVE' ? 'warning' : loan.status === 'CLOSED' ? 'success' : 'default'}
          />
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={8} sx={{ py: 0, borderBottom: 'none' }}>
          <Collapse in={open} timeout="auto">
            <Box sx={{ p: 2 }}>
              <Grid container spacing={2} sx={{ mb: 2 }}>
                <Grid item xs={12} sm={3}>
                  <Typography variant="caption" color="text.secondary">Disbursed</Typography>
                  <Typography>{formatDate(loan.disbursedOn)}</Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="caption" color="text.secondary">Tenure</Typography>
                  <Typography>{loan.tenureMonths} months</Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="caption" color="text.secondary">Paid So Far</Typography>
                  <Typography>{formatINR(totalPaid)}</Typography>
                </Grid>
                <Grid item xs={12} sm={3}>
                  <Typography variant="caption" color="text.secondary">Total Interest Paid</Typography>
                  <Typography>{formatINR(totalInterest)}</Typography>
                </Grid>
              </Grid>

              <Box sx={{ mb: 2 }}>
                <Typography variant="caption" color="text.secondary">Progress: {progressPct.toFixed(1)}% repaid</Typography>
                <Box sx={{ width: '100%', height: 8, bgcolor: 'grey.200', borderRadius: 4, mt: 0.5 }}>
                  <Box sx={{ width: `${progressPct}%`, height: '100%', bgcolor: 'success.main', borderRadius: 4 }} />
                </Box>
              </Box>

              <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => setPayOpen(true)} sx={{ mb: 2 }}>
                Record Payment
              </Button>

              {loan.payments.length > 0 && (
                <TableContainer component={Paper} elevation={0} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">EMI</TableCell>
                        <TableCell align="right">Principal</TableCell>
                        <TableCell align="right">Interest</TableCell>
                        <TableCell align="right">Balance</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {loan.payments.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{formatDate(p.paidOn)}</TableCell>
                          <TableCell align="right">{formatINRDecimal(p.amount)}</TableCell>
                          <TableCell align="right">{formatINRDecimal(p.principal)}</TableCell>
                          <TableCell align="right">{formatINRDecimal(p.interest)}</TableCell>
                          <TableCell align="right">{formatINR(p.balance)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>

      <Dialog open={payOpen} onClose={() => setPayOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Record Loan Payment — {loan.name}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label="Payment Amount" type="number" value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            <TextField label="Principal Component" type="number" value={payForm.principal}
              onChange={(e) => setPayForm({ ...payForm, principal: e.target.value })} />
            <TextField label="Interest Component" type="number" value={payForm.interest}
              onChange={(e) => setPayForm({ ...payForm, interest: e.target.value })} />
            <TextField label="Remaining Balance" type="number" value={payForm.balance}
              onChange={(e) => setPayForm({ ...payForm, balance: e.target.value })} />
            <TextField label="Payment Date" type="date" value={payForm.paidOn}
              onChange={(e) => setPayForm({ ...payForm, paidOn: e.target.value })} InputLabelProps={{ shrink: true }} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handlePayment}>Save Payment</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

export default function Loans() {
  const { data: loans, loading, refetch } = useApi<Loan[]>('/api/loans');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', lender: '', principal: '', interestRate: '', tenureMonths: '',
    monthlyEmi: '', disbursedOn: new Date().toISOString().slice(0, 10),
  });

  const allLoans = loans || [];
  const totalDebt = allLoans.reduce((s, l) => s + l.remainingPrincipal, 0);
  const totalEmi = allLoans.filter(l => l.status === 'ACTIVE').reduce((s, l) => s + l.monthlyEmi, 0);
  const activeCount = allLoans.filter(l => l.status === 'ACTIVE').length;

  const handleSubmit = async () => {
    await apiPost('/api/loans', {
      ...form,
      principal: parseFloat(form.principal),
      interestRate: parseFloat(form.interestRate),
      tenureMonths: parseInt(form.tenureMonths),
      monthlyEmi: parseFloat(form.monthlyEmi),
    });
    setOpen(false);
    setForm({ name: '', lender: '', principal: '', interestRate: '', tenureMonths: '', monthlyEmi: '', disbursedOn: new Date().toISOString().slice(0, 10) });
    refetch();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h3" fontWeight={700}>Loans</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Add Loan
        </Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <StatCard title="Outstanding Debt" value={formatINR(totalDebt)} color="error.main" icon={<HomeWorkIcon sx={{ fontSize: 40 }} />} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard title="Monthly EMI" value={formatINRDecimal(totalEmi)} color="warning.main" />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard title="Active Loans" value={String(activeCount)} />
        </Grid>
      </Grid>

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell />
              <TableCell>Loan Name</TableCell>
              <TableCell>Lender</TableCell>
              <TableCell align="right">Principal</TableCell>
              <TableCell align="right">Monthly EMI</TableCell>
              <TableCell align="right">Rate</TableCell>
              <TableCell align="right">Outstanding</TableCell>
              <TableCell>Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8}>Loading...</TableCell></TableRow>
            ) : allLoans.length === 0 ? (
              <TableRow><TableCell colSpan={8} align="center">No loans tracked yet. Click "Add Loan" to get started.</TableCell></TableRow>
            ) : allLoans.map((loan) => <LoanRow key={loan.id} loan={loan} />)}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Add Loan</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label="Loan Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Lender (optional)" value={form.lender} onChange={(e) => setForm({ ...form, lender: e.target.value })} />
            <TextField label="Principal Amount" type="number" value={form.principal} onChange={(e) => setForm({ ...form, principal: e.target.value })} />
            <TextField label="Interest Rate (% per annum)" type="number" value={form.interestRate} onChange={(e) => setForm({ ...form, interestRate: e.target.value })} />
            <TextField label="Tenure (months)" type="number" value={form.tenureMonths} onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })} />
            <TextField label="Monthly EMI" type="number" value={form.monthlyEmi} onChange={(e) => setForm({ ...form, monthlyEmi: e.target.value })} />
            <TextField label="Disbursed Date" type="date" value={form.disbursedOn} onChange={(e) => setForm({ ...form, disbursedOn: e.target.value })} InputLabelProps={{ shrink: true }} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.name || !form.principal || !form.interestRate || !form.tenureMonths || !form.monthlyEmi}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

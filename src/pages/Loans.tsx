import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiPost, apiPut, apiDelete, ApiError } from '../lib/api';
import {
  Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControl, Grid, IconButton, InputLabel, MenuItem, Paper, Select, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField,
  Tooltip, Typography, Chip, Collapse,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { formatINR, formatINRDecimal, formatDate, formatPercent, todayIST } from '../lib/format';
import StatCard from '../components/StatCard';
import HomeWorkIcon from '@mui/icons-material/HomeWork';

interface LoanPayment {
  id: string; amount: number; principal: number; interest: number; balance: number; paidOn: string;
}
interface User {
  id: string; name: string; initials: string; color: string;
}
interface Loan {
  id: string; name: string; lender?: string | null; principal: number;
  interestRate: number; tenureMonths: number; monthlyEmi: number;
  disbursedOn: string; endDate?: string | null; remainingPrincipal: number;
  status: string; accountId?: string | null; userId?: string | null;
  user?: { id: string; name: string; initials: string; color: string } | null;
  payments: LoanPayment[];
}

const LOAN_STATUSES = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'CLOSED', label: 'Closed' },
  { value: 'PRECLOSED', label: 'Pre-closed' },
];

const asDateInput = (value?: string | null) => (value ? value.slice(0, 10) : '');

const EMPTY_FORM = {
  name: '', lender: '', principal: '', remainingPrincipal: '', interestRate: '',
  tenureMonths: '', monthlyEmi: '', disbursedOn: todayIST(), endDate: '',
  status: 'ACTIVE', userId: '',
};

// ─────────────────────────────────────────────────────────────

function LoanRow({
  loan, onEdit, onChanged,
}: {
  loan: Loan;
  onEdit: (loan: Loan) => void;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    amount: String(loan.monthlyEmi), principal: '', interest: '', balance: '', paidOn: todayIST(),
  });
  const [payError, setPayError] = useState<string | null>(null);

  const handlePayment = async () => {
    setPayError(null);
    try {
      await apiPost(`/api/loans/${loan.id}/payment`, {
        amount: parseFloat(payForm.amount),
        principal: parseFloat(payForm.principal || '0'),
        interest: parseFloat(payForm.interest || '0'),
        balance: parseFloat(payForm.balance || '0'),
        paidOn: payForm.paidOn,
      });
      setPayOpen(false);
      setPayForm({ amount: String(loan.monthlyEmi), principal: '', interest: '', balance: '', paidOn: todayIST() });
      // Refetch rather than reloading the whole page, which used to lose the
      // scroll position and the expanded row.
      onChanged();
    } catch (err) {
      setPayError(err instanceof ApiError ? err.message : 'Could not record this payment.');
    }
  };

  const handleDeletePayment = async (p: LoanPayment) => {
    if (
      !confirm(
        `Delete the payment of ${formatINRDecimal(p.amount)} on ${formatDate(p.paidOn)}?\n\nThe outstanding balance will be restored to the previous payment, or to the original principal if none remain.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/api/loans/${loan.id}/payments/${p.id}`);
      onChanged();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not delete this payment.');
    }
  };

  const paidAmount = loan.principal - loan.remainingPrincipal;
  const progressPct = loan.principal > 0 ? Math.min(100, Math.max(0, (paidAmount / loan.principal) * 100)) : 0;
  const totalInterest = loan.payments.reduce((s, p) => s + p.interest, 0);
  const totalPaid = loan.payments.reduce((s, p) => s + p.amount, 0);

  const toggle = () => setOpen((v) => !v);

  return (
    <>
      <TableRow hover sx={{ cursor: 'pointer' }}>
        <TableCell onClick={toggle}>
          <IconButton size="small">{open ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}</IconButton>
        </TableCell>
        <TableCell onClick={toggle}><Typography fontWeight={600}>{loan.name}</Typography></TableCell>
        <TableCell onClick={toggle}>{loan.lender || '—'}</TableCell>
        <TableCell onClick={toggle}>
          {loan.user ? (
            <Chip
              label={loan.user.initials}
              size="small"
              sx={{ fontWeight: 700, bgcolor: loan.user.color, color: 'white' }}
            />
          ) : ('—')}
        </TableCell>
        <TableCell align="right" onClick={toggle}>{formatINR(loan.principal)}</TableCell>
        <TableCell align="right" onClick={toggle}>{formatINRDecimal(loan.monthlyEmi)}</TableCell>
        <TableCell align="right" onClick={toggle}>{formatPercent(loan.interestRate)}</TableCell>
        <TableCell align="right" onClick={toggle}>{formatINR(loan.remainingPrincipal)}</TableCell>
        <TableCell onClick={toggle}>
          <Chip
            label={LOAN_STATUSES.find((s) => s.value === loan.status)?.label ?? loan.status}
            size="small"
            color={loan.status === 'ACTIVE' ? 'warning' : loan.status === 'CLOSED' ? 'success' : 'default'}
          />
        </TableCell>
        <TableCell onClick={(e) => e.stopPropagation()}>
          <Tooltip title="Edit loan">
            <IconButton size="small" onClick={() => onEdit(loan)}>
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={10} sx={{ py: 0, borderBottom: 'none' }}>
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

              <Stack direction="row" spacing={1} sx={{ mb: 2 }}>
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={() => setPayOpen(true)}>
                  Record Payment
                </Button>
                <Button variant="text" size="small" startIcon={<EditIcon />} onClick={() => onEdit(loan)}>
                  Edit details
                </Button>
              </Stack>

              {loan.payments.length > 0 ? (
                <TableContainer component={Paper} elevation={0} variant="outlined">
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Date</TableCell>
                        <TableCell align="right">EMI</TableCell>
                        <TableCell align="right">Principal</TableCell>
                        <TableCell align="right">Interest</TableCell>
                        <TableCell align="right">Balance</TableCell>
                        <TableCell />
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
                          <TableCell align="right">
                            <Tooltip title="Delete this payment">
                              <IconButton size="small" onClick={() => handleDeletePayment(p)}>
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No payments recorded yet.
                </Typography>
              )}
            </Box>
          </Collapse>
        </TableCell>
      </TableRow>

      <Dialog open={payOpen} onClose={() => setPayOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Record Loan Payment — {loan.name}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {payError && <Alert severity="error">{payError}</Alert>}
            <TextField label="Payment Amount" type="number" value={payForm.amount}
              onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} />
            <TextField label="Principal Component" type="number" value={payForm.principal}
              onChange={(e) => setPayForm({ ...payForm, principal: e.target.value })} />
            <TextField label="Interest Component" type="number" value={payForm.interest}
              onChange={(e) => setPayForm({ ...payForm, interest: e.target.value })} />
            <TextField label="Remaining Balance" type="number" value={payForm.balance}
              onChange={(e) => setPayForm({ ...payForm, balance: e.target.value })}
              helperText="Becomes the loan's outstanding amount" />
            <TextField label="Payment Date" type="date" value={payForm.paidOn}
              onChange={(e) => setPayForm({ ...payForm, paidOn: e.target.value })} InputLabelProps={{ shrink: true }} />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPayOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handlePayment} disabled={!payForm.amount}>Save Payment</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

// ─────────────────────────────────────────────────────────────

export default function Loans() {
  const { data: loans, loading, refetch } = useApi<Loan[]>('/api/loans');
  const { data: users } = useApi<User[]>('/api/users');

  const [open, setOpen] = useState(false);
  const [editLoan, setEditLoan] = useState<Loan | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const allLoans = loans || [];
  const usr = users || [];
  const totalDebt = allLoans.reduce((s, l) => s + l.remainingPrincipal, 0);
  const totalEmi = allLoans.filter(l => l.status === 'ACTIVE').reduce((s, l) => s + l.monthlyEmi, 0);
  const activeCount = allLoans.filter(l => l.status === 'ACTIVE').length;

  const openAdd = () => {
    setEditLoan(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setOpen(true);
  };

  const openEdit = (loan: Loan) => {
    setEditLoan(loan);
    setForm({
      name: loan.name,
      lender: loan.lender || '',
      principal: String(loan.principal),
      remainingPrincipal: String(loan.remainingPrincipal),
      interestRate: String(loan.interestRate),
      tenureMonths: String(loan.tenureMonths),
      monthlyEmi: String(loan.monthlyEmi),
      disbursedOn: asDateInput(loan.disbursedOn),
      endDate: asDateInput(loan.endDate),
      status: loan.status,
      userId: loan.userId || '',
    });
    setFormError(null);
    setOpen(true);
  };

  const handleSubmit = async () => {
    const payload = {
      name: form.name.trim(),
      lender: form.lender.trim() || null,
      principal: parseFloat(form.principal),
      interestRate: parseFloat(form.interestRate),
      tenureMonths: parseInt(form.tenureMonths, 10),
      monthlyEmi: parseFloat(form.monthlyEmi),
      disbursedOn: form.disbursedOn,
      endDate: form.endDate || null,
      userId: form.userId || null,
      ...(editLoan
        ? { status: form.status, remainingPrincipal: parseFloat(form.remainingPrincipal) }
        : {}),
    };

    if (
      !payload.name ||
      Number.isNaN(payload.principal) ||
      Number.isNaN(payload.interestRate) ||
      Number.isNaN(payload.tenureMonths) ||
      Number.isNaN(payload.monthlyEmi)
    ) {
      setFormError('Name, principal, rate, tenure and EMI are all required.');
      return;
    }
    if (editLoan && Number.isNaN(payload.remainingPrincipal)) {
      setFormError('Outstanding amount must be a number.');
      return;
    }

    try {
      if (editLoan) await apiPut(`/api/loans/${editLoan.id}`, payload);
      else await apiPost('/api/loans', payload);
      setOpen(false);
      refetch();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Could not save this loan.');
    }
  };

  const handleDelete = async (loan: Loan) => {
    if (
      !confirm(
        `Delete "${loan.name}"?\n\nThis also deletes its ${loan.payments.length} recorded payment(s). This cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/api/loans/${loan.id}`);
      setOpen(false);
      refetch();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not delete this loan.');
    }
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h3" fontWeight={700}>Loans</Typography>
          <Typography variant="body2" color="text.secondary">
            Expand a loan to see its payment history, record payments, or edit it.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<AddIcon />} onClick={openAdd}>
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
              <TableCell>Owner</TableCell>
              <TableCell align="right">Principal</TableCell>
              <TableCell align="right">Monthly EMI</TableCell>
              <TableCell align="right">Rate</TableCell>
              <TableCell align="right">Outstanding</TableCell>
              <TableCell>Status</TableCell>
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={10}>Loading...</TableCell></TableRow>
            ) : allLoans.length === 0 ? (
              <TableRow><TableCell colSpan={10} align="center">No loans tracked yet. Click "Add Loan" to get started.</TableCell></TableRow>
            ) : allLoans.map((loan) => (
              <LoanRow key={loan.id} loan={loan} onEdit={openEdit} onChanged={refetch} />
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editLoan ? `Edit Loan — ${editLoan.name}` : 'Add Loan'}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            {formError && <Alert severity="error">{formError}</Alert>}

            <TextField label="Loan Name" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
            <TextField label="Lender (optional)" value={form.lender}
              onChange={(e) => setForm({ ...form, lender: e.target.value })} />

            <FormControl fullWidth>
              <InputLabel>Owner</InputLabel>
              <Select value={form.userId} label="Owner" onChange={(e) => setForm({ ...form, userId: e.target.value })}>
                <MenuItem value=""><em>None</em></MenuItem>
                {usr.map((u) => (
                  <MenuItem key={u.id} value={u.id}>{u.name} ({u.initials})</MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField label="Principal Amount" type="number" value={form.principal}
              onChange={(e) => setForm({ ...form, principal: e.target.value })} />
            <TextField label="Interest Rate (% per annum)" type="number" value={form.interestRate}
              onChange={(e) => setForm({ ...form, interestRate: e.target.value })} />
            <TextField label="Tenure (months)" type="number" value={form.tenureMonths}
              onChange={(e) => setForm({ ...form, tenureMonths: e.target.value })} />
            <TextField label="Monthly EMI" type="number" value={form.monthlyEmi}
              onChange={(e) => setForm({ ...form, monthlyEmi: e.target.value })} />
            <TextField label="Disbursed Date" type="date" value={form.disbursedOn}
              onChange={(e) => setForm({ ...form, disbursedOn: e.target.value })} InputLabelProps={{ shrink: true }} />
            <TextField label="Expected End Date (optional)" type="date" value={form.endDate}
              onChange={(e) => setForm({ ...form, endDate: e.target.value })} InputLabelProps={{ shrink: true }} />

            {editLoan && (
              <>
                <TextField label="Outstanding Amount" type="number" value={form.remainingPrincipal}
                  onChange={(e) => setForm({ ...form, remainingPrincipal: e.target.value })}
                  helperText="Correct this if it has drifted from the recorded payments" />
                <FormControl fullWidth>
                  <InputLabel>Status</InputLabel>
                  <Select value={form.status} label="Status" onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    {LOAN_STATUSES.map((s) => (
                      <MenuItem key={s.value} value={s.value}>{s.label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2, justifyContent: 'space-between' }}>
          <Box>
            {editLoan && (
              <Button color="error" startIcon={<DeleteIcon />} onClick={() => handleDelete(editLoan)}>
                Delete loan
              </Button>
            )}
          </Box>
          <Box>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="contained" onClick={handleSubmit} sx={{ ml: 1 }}>
              {editLoan ? 'Save' : 'Create'}
            </Button>
          </Box>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

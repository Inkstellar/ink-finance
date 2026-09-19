import { useState } from 'react';
import { useApi } from '../hooks/useApi';
import { apiPost, apiDelete } from '../lib/api';
import {
  Box, Typography, Card, CardContent, Button, Dialog, DialogTitle, DialogContent,
  DialogActions, TextField, MenuItem, Select, FormControl, InputLabel,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Paper,
  Grid, Chip, IconButton
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import { formatINR, formatINRDecimal, formatPercent } from '../lib/format';
import StatCard from '../components/StatCard';

interface Investment {
  id: string; symbol: string; name: string; exchange?: string;
  assetType: string; quantity: number; avgBuyPrice: number;
  currentPrice: number; currency: string;
}

const ASSET_TYPES = [
  { value: 'STOCK', label: 'Stock' },
  { value: 'MUTUAL_FUND', label: 'Mutual Fund' },
  { value: 'ETF', label: 'ETF' },
  { value: 'BOND', label: 'Bond' },
  { value: 'CRYPTO', label: 'Crypto' },
  { value: 'GOLD', label: 'Gold' },
  { value: 'OTHER', label: 'Other' },
];

export default function Investments() {
  const { data: investments, loading, refetch } = useApi<Investment[]>('/api/investments');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    symbol: '', name: '', exchange: '', assetType: 'STOCK',
    quantity: '', avgBuyPrice: '', currentPrice: '',
  });

  const invs = investments || [];

  const totalInvested = invs.reduce((s, i) => s + i.avgBuyPrice * i.quantity, 0);
  const totalValue = invs.reduce((s, i) => s + i.currentPrice * i.quantity, 0);
  const totalPnl = totalValue - totalInvested;
  const pnlPercent = totalInvested > 0 ? (totalPnl / totalInvested) * 100 : 0;

  const handleSubmit = async () => {
    await apiPost('/api/investments', {
      ...form,
      quantity: parseFloat(form.quantity),
      avgBuyPrice: parseFloat(form.avgBuyPrice),
      currentPrice: parseFloat(form.currentPrice || form.avgBuyPrice),
    });
    setOpen(false);
    setForm({ symbol: '', name: '', exchange: '', assetType: 'STOCK', quantity: '', avgBuyPrice: '', currentPrice: '' });
    refetch();
  };

  const handleDelete = async (id: string) => {
    await apiDelete(`/api/investments/${id}`);
    refetch();
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h3" fontWeight={700}>Investments</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setOpen(true)}>
          Add Holding
        </Button>
      </Box>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={4}>
          <StatCard title="Invested" value={formatINR(totalInvested)} icon={<TrendingUpIcon sx={{ fontSize: 40 }} />} />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard title="Current Value" value={formatINR(totalValue)} color="primary.main" />
        </Grid>
        <Grid item xs={12} sm={4}>
          <StatCard
            title="P&L"
            value={`${formatINR(totalPnl)} (${formatPercent(pnlPercent)})`}
            color={totalPnl >= 0 ? 'success.main' : 'error.main'}
          />
        </Grid>
      </Grid>

      <TableContainer component={Paper} elevation={0}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Symbol</TableCell>
              <TableCell>Name</TableCell>
              <TableCell>Type</TableCell>
              <TableCell align="right">Qty</TableCell>
              <TableCell align="right">Avg Buy</TableCell>
              <TableCell align="right">Current</TableCell>
              <TableCell align="right">Value</TableCell>
              <TableCell align="right">P&L</TableCell>
              <TableCell></TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9}>Loading...</TableCell></TableRow>
            ) : invs.length === 0 ? (
              <TableRow><TableCell colSpan={9} align="center">No holdings yet. Click "Add Holding" to get started.</TableCell></TableRow>
            ) : invs.map((inv) => {
              const value = inv.currentPrice * inv.quantity;
              const invested = inv.avgBuyPrice * inv.quantity;
              const pnl = value - invested;
              const pnlPct = invested > 0 ? (pnl / invested) * 100 : 0;
              return (
                <TableRow key={inv.id} hover>
                  <TableCell><Typography fontWeight={600}>{inv.symbol}</Typography></TableCell>
                  <TableCell>{inv.name}</TableCell>
                  <TableCell>
                    <Chip label={inv.assetType.replace(/_/g, ' ')} size="small" variant="outlined" />
                  </TableCell>
                  <TableCell align="right">{inv.quantity}</TableCell>
                  <TableCell align="right">{formatINRDecimal(inv.avgBuyPrice)}</TableCell>
                  <TableCell align="right">{formatINRDecimal(inv.currentPrice)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 600 }}>{formatINR(value)}</TableCell>
                  <TableCell align="right" sx={{ color: pnl >= 0 ? 'success.main' : 'error.main', fontWeight: 600 }}>
                    {formatINR(pnl)}
                    <Typography variant="caption" display="block">
                      {formatPercent(pnlPct)}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <IconButton size="small" onClick={() => handleDelete(inv.id)}>
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
        <DialogTitle>Add Investment Holding</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField label="Symbol" value={form.symbol} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            <TextField label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <TextField label="Exchange (optional)" value={form.exchange} onChange={(e) => setForm({ ...form, exchange: e.target.value })} />
            <FormControl fullWidth>
              <InputLabel>Asset Type</InputLabel>
              <Select value={form.assetType} label="Asset Type" onChange={(e) => setForm({ ...form, assetType: e.target.value })}>
                {ASSET_TYPES.map((a) => <MenuItem key={a.value} value={a.value}>{a.label}</MenuItem>)}
              </Select>
            </FormControl>
            <TextField label="Quantity" type="number" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} />
            <TextField label="Avg Buy Price" type="number" value={form.avgBuyPrice} onChange={(e) => setForm({ ...form, avgBuyPrice: e.target.value })} />
            <TextField label="Current Price" type="number" value={form.currentPrice} onChange={(e) => setForm({ ...form, currentPrice: e.target.value })}
              helperText="Leave empty to use buy price" />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSubmit} disabled={!form.symbol || !form.quantity || !form.avgBuyPrice}>
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

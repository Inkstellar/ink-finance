import { useApi } from '../hooks/useApi';
import { Grid, Card, CardContent, Typography, Box, List, ListItem, ListItemText, Chip } from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import HomeWorkIcon from '@mui/icons-material/HomeWork';
import SavingsIcon from '@mui/icons-material/Savings';
import StatCard from '../components/StatCard';
import { formatINR, formatINRDecimal, formatDate, formatPercent } from '../lib/format';

interface DashboardData {
  totalBalance: number;
  totalInvested: number;
  totalInvestmentValue: number;
  investmentPnl: number;
  totalLoanDebt: number;
  netWorth: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  monthlySavings: number;
  recentTransactions: Array<{
    id: string;
    amount: number;
    type: string;
    description: string;
    date: string;
    category?: { name: string; color: string };
  }>;
  accountCount: number;
  activeLoans: number;
}

export default function Dashboard() {
  const { data, loading } = useApi<DashboardData>('/api/dashboard');
  const d = data as DashboardData;

  if (loading || !d) {
    return <Typography>Loading dashboard...</Typography>;
  }

  const pnlPercent = d.totalInvested > 0
    ? (d.investmentPnl / d.totalInvested) * 100
    : 0;

  const txColors: Record<string, string> = {
    INCOME: 'success.main',
    EXPENSE: 'error.main',
    TRANSFER: 'info.main',
    INVESTMENT_BUY: 'warning.main',
    INVESTMENT_SELL: 'secondary.main',
    LOAN_PAYMENT: 'warning.main',
  };

  return (
    <Box>
      <Typography variant="h3" gutterBottom fontWeight={700}>
        Dashboard
      </Typography>

      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Net Worth"
            value={formatINR(d.netWorth)}
            subtitle={`${d.accountCount} accounts`}
            color="primary.main"
            icon={<AccountBalanceWalletIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Total Balance"
            value={formatINR(d.totalBalance)}
            subtitle="Across all accounts"
            color="success.main"
            icon={<SavingsIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Investments"
            value={formatINR(d.totalInvestmentValue)}
            subtitle={`${formatINR(d.investmentPnl)} (${formatPercent(pnlPercent)})`}
            color={d.investmentPnl >= 0 ? 'success.main' : 'error.main'}
            icon={<TrendingUpIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard
            title="Outstanding Loans"
            value={formatINR(d.totalLoanDebt)}
            subtitle={`${d.activeLoans} active loans`}
            color="error.main"
            icon={<HomeWorkIcon sx={{ fontSize: 40 }} />}
          />
        </Grid>
      </Grid>

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>This Month</Typography>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">Income</Typography>
                <Typography color="success.main" fontWeight={600}>
                  {formatINR(d.monthlyIncome)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
                <Typography color="text.secondary">Expenses</Typography>
                <Typography color="error.main" fontWeight={600}>
                  {formatINR(d.monthlyExpenses)}
                </Typography>
              </Box>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', pt: 1, borderTop: 1, borderColor: 'divider' }}>
                <Typography fontWeight={600}>Savings</Typography>
                <Typography fontWeight={700} color={d.monthlySavings >= 0 ? 'success.main' : 'error.main'}>
                  {formatINR(d.monthlySavings)}
                </Typography>
              </Box>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={8}>
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>Recent Transactions</Typography>
              <List dense>
                {d.recentTransactions.length === 0 && (
                  <Typography color="text.secondary" sx={{ py: 2 }}>
                    No transactions this month yet.
                  </Typography>
                )}
                {d.recentTransactions.map((tx) => (
                  <ListItem key={tx.id} divider>
                    <ListItemText
                      primary={tx.description}
                      secondary={`${formatDate(tx.date)}${tx.category ? ' · ' + tx.category.name : ''}`}
                    />
                    <Chip
                      label={formatINRDecimal(tx.amount)}
                      size="small"
                      color={
                        tx.type === 'INCOME' ? 'success' :
                        tx.type === 'EXPENSE' ? 'error' :
                        'default'
                      }
                      variant="outlined"
                      sx={{ fontWeight: 600 }}
                    />
                  </ListItem>
                ))}
              </List>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

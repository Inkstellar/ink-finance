import { Card, CardContent, Typography, Box, Skeleton } from '@mui/material';
import { ReactNode } from 'react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  color?: string;
  icon?: ReactNode;
  loading?: boolean;
}

export default function StatCard({ title, value, subtitle, color = 'text.primary', icon, loading }: StatCardProps) {
  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              {title}
            </Typography>
            {loading ? (
              <Skeleton width={120} height={32} />
            ) : (
              <Typography variant="h4" fontWeight={700} color={color}>
                {value}
              </Typography>
            )}
            {subtitle && (
              <Typography variant="caption" color="text.secondary">
                {subtitle}
              </Typography>
            )}
          </Box>
          {icon && <Box sx={{ opacity: 0.3 }}>{icon}</Box>}
        </Box>
      </CardContent>
    </Card>
  );
}

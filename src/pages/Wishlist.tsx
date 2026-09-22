import { useApi } from '../hooks/useApi';
import { apiDelete } from '../lib/api';
import { formatINRDecimal } from '../lib/format';
import {
  Box, Typography, Card, CardContent, CardMedia, CardActions,
  Button, IconButton, Chip, Stack, Paper, Tooltip, Link as MuiLink,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart';

interface WishlistItem {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  imageUrl: string | null;
  productUrl: string;
  notes: string | null;
  userId: string | null;
  createdAt: string;
  user?: { id: string; name: string; initials: string; color: string | null } | null;
}

/** Extract a short domain from a URL for the chip label. */
function domain(url: string): string {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    // "amazon.in" not "amazon.in/dp/…"
    return h;
  } catch {
    return 'link';
  }
}

export default function Wishlist() {
  const { data: items, loading, refetch } = useApi<WishlistItem[]>('/api/wishlist');

  const handleDelete = async (id: string) => {
    await apiDelete(`/api/wishlist/${id}`);
    refetch();
  };

  const list = items || [];

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3, flexWrap: 'wrap', gap: 1 }}>
        <Box>
          <Typography variant="h3" fontWeight={700}>Wishlist</Typography>
          <Typography variant="body2" color="text.secondary">
            Send a product link to the Telegram bot to add items here.
          </Typography>
        </Box>
        {!loading && (
          <Chip
            label={`${list.length} item${list.length === 1 ? '' : 's'}`}
            size="small"
            color="primary"
            variant="outlined"
          />
        )}
      </Box>

      {loading ? (
        <Paper elevation={0} sx={{ p: 4, textAlign: 'center' }}>
          <Typography color="text.secondary">Loading…</Typography>
        </Paper>
      ) : list.length === 0 ? (
        <Paper elevation={0} sx={{ p: 4, textAlign: 'center' }}>
          <ShoppingCartIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 1 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            Your wishlist is empty
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Paste any Amazon, Flipkart or shopping link into the Telegram bot —
            it will pull the product details and add them here automatically.
          </Typography>
        </Paper>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gap: 2,
            gridTemplateColumns: {
              xs: '1fr',
              sm: 'repeat(2, 1fr)',
              lg: 'repeat(3, 1fr)',
            },
          }}
        >
          {list.map((item) => (
            <Card key={item.id} elevation={0} sx={{ display: 'flex', flexDirection: 'column' }}>
              {item.imageUrl && (
                <CardMedia
                  component="img"
                  image={item.imageUrl}
                  alt={item.name}
                  sx={{ height: 200, objectFit: 'contain', bgcolor: '#f5f5f5', p: 2 }}
                />
              )}
              <CardContent sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={600} gutterBottom sx={{ lineHeight: 1.3 }}>
                  {item.name}
                </Typography>

                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  {item.price != null && (
                    <Typography variant="h6" color="primary.main" fontWeight={700}>
                      {item.currency === 'INR' ? formatINRDecimal(item.price) : `${item.currency} ${item.price}`}
                    </Typography>
                  )}
                  <Chip label={domain(item.productUrl)} size="small" variant="outlined" />
                  {item.user && (
                    <Chip
                      label={item.user.name}
                      size="small"
                      sx={{
                        bgcolor: item.user.color || 'grey.300',
                        color: '#fff',
                        fontWeight: 600,
                      }}
                    />
                  )}
                </Stack>

                {item.notes && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                    {item.notes}
                  </Typography>
                )}
              </CardContent>

              <CardActions sx={{ px: 2, pb: 2, pt: 0, justifyContent: 'space-between' }}>
                <Button
                  size="small"
                  startIcon={<OpenInNewIcon />}
                  component={MuiLink}
                  href={item.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View Product
                </Button>
                <Tooltip title="Remove from wishlist">
                  <IconButton size="small" onClick={() => handleDelete(item.id)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}
    </Box>
  );
}

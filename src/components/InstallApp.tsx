import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material';
import InstallMobileIcon from '@mui/icons-material/InstallMobile';
import IosShareIcon from '@mui/icons-material/IosShare';
import AddBoxOutlinedIcon from '@mui/icons-material/AddBoxOutlined';
import { installOffer, promptInstall } from '../lib/pwa';
import { useInstallState } from '../hooks/useInstallState';

/**
 * iOS has no programmatic install, so the only honest thing to show is where
 * the button is. Steps, not prose — this is read one-handed on a phone.
 */
const IOS_STEPS = [
  { icon: <IosShareIcon fontSize="small" />, text: 'Tap the Share button in Safari’s toolbar.' },
  { icon: <AddBoxOutlinedIcon fontSize="small" />, text: 'Scroll down and tap “Add to Home Screen”.' },
  { icon: null, text: 'Tap “Add”. Ink Finance then opens full screen, like an app.' },
];

/**
 * The "Install app" entry in the sidebar.
 *
 * Renders nothing unless there is something useful to say: either the browser
 * has handed us an install prompt we can show, or we are on iOS Safari where
 * the user has to do it themselves. Once the app is running standalone it
 * disappears for good.
 */
export default function InstallApp({ onNavigate }: { onNavigate?: () => void }) {
  const state = useInstallState();
  const [open, setOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  const offer = installOffer(state);
  if (offer === 'none') return null;

  const handleInstall = async () => {
    setInstalling(true);
    const outcome = await promptInstall();
    setInstalling(false);
    // 'dismissed' keeps the dialog open: the user may want to try again, and
    // Chrome will not offer the prompt a second time once it is used.
    if (outcome === 'accepted') {
      setOpen(false);
      onNavigate?.();
    }
  };

  return (
    <>
      <ListItemButton
        onClick={() => setOpen(true)}
        sx={{
          borderRadius: 2,
          mb: 1,
          minHeight: 44,
          border: '1px solid',
          borderColor: 'divider',
        }}
      >
        <ListItemIcon sx={{ minWidth: 40, color: 'primary.main' }}>
          <InstallMobileIcon />
        </ListItemIcon>
        <ListItemText
          primary="Install app"
          primaryTypographyProps={{ fontSize: '0.875rem', fontWeight: 500 }}
        />
      </ListItemButton>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>
          {offer === 'prompt' ? 'Install Ink Finance' : 'Add to your home screen'}
        </DialogTitle>

        <DialogContent dividers>
          {offer === 'prompt' ? (
            <Typography variant="body2" color="text.secondary">
              Add Ink Finance to your home screen. It opens full screen, starts instantly, and
              keeps you signed in — no browser address bar in the way.
            </Typography>
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Safari cannot install an app for you, but it only takes three taps:
              </Typography>
              {IOS_STEPS.map((step, index) => (
                <Stack key={step.text} direction="row" spacing={1.5} alignItems="flex-start">
                  <Box
                    sx={{
                      width: 24,
                      height: 24,
                      flexShrink: 0,
                      borderRadius: '50%',
                      bgcolor: 'primary.main',
                      color: 'white',
                      fontSize: 13,
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {index + 1}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography variant="body2" sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
                      {step.icon}
                      {step.text}
                    </Typography>
                  </Box>
                </Stack>
              ))}
            </Stack>
          )}
        </DialogContent>

        <DialogActions>
          {offer === 'prompt' ? (
            <>
              <Button onClick={() => setOpen(false)} sx={{ textTransform: 'none' }}>
                Not now
              </Button>
              <Button
                variant="contained"
                onClick={handleInstall}
                disabled={installing}
                sx={{ textTransform: 'none' }}
              >
                {installing ? 'Installing…' : 'Install'}
              </Button>
            </>
          ) : (
            <Button
              variant="contained"
              onClick={() => {
                setOpen(false);
                onNavigate?.();
              }}
              sx={{ textTransform: 'none' }}
            >
              Got it
            </Button>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}

import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import TodayIcon from '@mui/icons-material/Today';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import EventBusyIcon from '@mui/icons-material/EventBusy';
import { useApi } from '../hooks/useApi';
import { useSession } from '../hooks/useSession';
import { apiPost, apiPut, apiDelete, ApiError } from '../lib/api';
import { todayIST } from '../lib/format';
import {
  WEEKDAY_LABELS,
  addDays,
  addMonths,
  dayKey,
  daysInMonth,
  eventsByDay,
  formatDayLong,
  formatDayShort,
  formatMonth,
  formatTime,
  gridRange,
  monthMatrix,
  parseDayKey,
  relativeDayLabel,
  toDayKey,
  type DayKey,
} from '../lib/calendar';
import UserAvatar from '../components/UserAvatar';

/** A user as embedded on an event, or as returned by `/api/users`. */
interface Person {
  id: string;
  name: string;
  initials: string;
  color: string;
  hasAvatar?: boolean;
  updatedAt?: string;
}

interface CalEvent {
  id: string;
  title: string;
  /** UTC midnight of the first day, as an ISO string. */
  date: string;
  endDate: string | null;
  /** `HH:MM`, or null for an all-day event. */
  startTime: string | null;
  notes: string | null;
  user: Person | null;
}

/** Colour for an event nobody claimed, so it still reads as deliberate. */
const UNASSIGNED = '#78909c';

const colorOf = (event: CalEvent) => event.user?.color || UNASSIGNED;

/**
 * `2026-09-21T00:00:00.000Z` → `2026-09-21`, or `''` when there is no date.
 *
 * Delegates to the calendar lib so the page and the grid cannot disagree about
 * what a day key is; `''` keeps the comparisons below readable.
 */
const keyOf = (value: string | null | undefined) => toDayKey(value) ?? '';

const isMultiDay = (event: CalEvent) => Boolean(event.endDate && keyOf(event.endDate) !== keyOf(event.date));

/**
 * How a day reads in the "coming up" list: `Today`, `Tomorrow`, or the date.
 *
 * An event already under way says `Ongoing` rather than naming a day that has
 * passed, which would read as though it had been missed.
 */
function whenLabel(event: CalEvent, today: DayKey): string {
  const start = keyOf(event.date);
  if (start < today) return 'Ongoing';
  return relativeDayLabel(start, today) ?? formatDayShort(start);
}

interface FormState {
  title: string;
  date: DayKey;
  multiDay: boolean;
  endDate: DayKey;
  hasTime: boolean;
  startTime: string;
  userId: string;
  notes: string;
}

/**
 * One day in the month grid.
 *
 * The whole cell is the click target rather than the individual chips: the
 * chips are too small to hit reliably on a phone, and nesting buttons inside a
 * button is invalid HTML anyway. Editing happens from the agenda, where there
 * is room for a real label.
 */
function DayCell({
  cell,
  events,
  selected,
  today,
  onSelect,
}: {
  cell: { key: DayKey; day: number; inMonth: boolean; weekend: boolean };
  events: CalEvent[];
  selected: boolean;
  today: DayKey;
  onSelect: (key: DayKey) => void;
}) {
  const isToday = cell.key === today;
  const count = events.length;

  // Three chips is already more than a 100px cell holds with a "+N" line, so
  // the overflow count is what tells the truth about a busy day.
  const shown = events.slice(0, 2);
  const hidden = count - shown.length;

  return (
    <Box
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${formatDayLong(cell.key)}${count ? `, ${count} event${count === 1 ? '' : 's'}` : ', no events'}`}
      onClick={() => onSelect(cell.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect(cell.key);
        }
      }}
      sx={{
        // Opaque, because the 1px gridlines are the container's background
        // showing through the gaps.
        bgcolor: isToday
          ? alpha('#1a237e', 0.07)
          : cell.weekend
            ? '#f7f8fb'
            : 'background.paper',
        p: { xs: 0.5, sm: 0.75 },
        minHeight: { xs: 58, sm: 84, md: 100 },
        minWidth: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
        gap: 0.25,
        cursor: 'pointer',
        outline: selected ? '2px solid' : 'none',
        outlineColor: 'primary.main',
        // Inset, so the ring does not overlap the neighbouring cell.
        outlineOffset: -2,
        position: 'relative',
        transition: 'background-color 0.15s ease',
        '&:hover': { bgcolor: isToday ? alpha('#1a237e', 0.11) : 'action.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <Box
        sx={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          flexShrink: 0,
          bgcolor: isToday ? 'primary.main' : 'transparent',
          color: isToday ? '#fff' : cell.inMonth ? 'text.primary' : 'text.disabled',
          fontSize: 12,
          fontWeight: isToday || selected ? 700 : 500,
        }}
      >
        {cell.day}
      </Box>

      {/* Phone: dots. A chip with a readable title needs ~90px and there are
          only ~48px per column at 390px, so text here would be noise. */}
      <Box sx={{ display: { xs: 'flex', sm: 'none' }, gap: 0.25, flexWrap: 'wrap', alignItems: 'center' }}>
        {events.slice(0, 4).map((event) => (
          <Box
            key={event.id}
            sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: colorOf(event), flexShrink: 0 }}
          />
        ))}
        {count > 4 && (
          <Typography variant="caption" sx={{ fontSize: 9, lineHeight: 1, color: 'text.secondary' }}>
            +{count - 4}
          </Typography>
        )}
      </Box>

      {/* Tablet and up: titled chips. */}
      <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexDirection: 'column', gap: 0.25, minWidth: 0 }}>
        {shown.map((event) => (
          <Box
            key={event.id}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              px: 0.5,
              py: 0.125,
              borderRadius: 0.75,
              bgcolor: alpha(colorOf(event), 0.14),
              borderLeft: `3px solid ${colorOf(event)}`,
              minWidth: 0,
            }}
          >
            {event.startTime && (
              <Typography
                variant="caption"
                sx={{ fontSize: 10, lineHeight: 1.4, fontWeight: 700, color: colorOf(event), flexShrink: 0 }}
              >
                {formatTime(event.startTime)}
              </Typography>
            )}
            <Typography variant="caption" noWrap sx={{ fontSize: 11, lineHeight: 1.4, minWidth: 0 }}>
              {event.title}
            </Typography>
          </Box>
        ))}
        {hidden > 0 && (
          <Typography variant="caption" sx={{ fontSize: 10, lineHeight: 1.3, color: 'text.secondary', pl: 0.5 }}>
            +{hidden} more
          </Typography>
        )}
      </Box>
    </Box>
  );
}

/** One event in the selected day's agenda. */
function AgendaRow({
  event,
  onEdit,
  onDelete,
}: {
  event: CalEvent;
  onEdit: (event: CalEvent) => void;
  onDelete: (event: CalEvent) => void;
}) {
  const color = colorOf(event);
  const spans = isMultiDay(event);

  return (
    <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', py: 1 }}>
      <Box sx={{ width: 4, alignSelf: 'stretch', borderRadius: 1, bgcolor: color, flexShrink: 0, minHeight: 32 }} />
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>
          {event.title}
        </Typography>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mt: 0.25, flexWrap: 'wrap', rowGap: 0.25 }}>
          <Typography variant="caption" color="text.secondary">
            {event.startTime ? formatTime(event.startTime) : 'All day'}
          </Typography>
          {spans && (
            <Typography variant="caption" color="text.secondary">
              · until {formatDayShort(keyOf(event.endDate))}
            </Typography>
          )}
          {event.user ? (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <UserAvatar user={event.user} size={16} />
              <Typography variant="caption" color="text.secondary">
                {event.user.name}
              </Typography>
            </Stack>
          ) : (
            <Typography variant="caption" color="text.secondary">
              · Unassigned
            </Typography>
          )}
        </Stack>
        {event.notes && (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>
            {event.notes}
          </Typography>
        )}
      </Box>
      <Stack direction="row" sx={{ flexShrink: 0 }}>
        <Tooltip title="Edit">
          <IconButton size="small" onClick={() => onEdit(event)} aria-label={`Edit ${event.title}`}>
            <EditIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" color="error" onClick={() => onDelete(event)} aria-label={`Delete ${event.title}`}>
            <DeleteIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Box>
  );
}

export default function Calendar() {
  const { session } = useSession();
  const today = todayIST();

  const [cursor, setCursor] = useState(() => {
    const parts = parseDayKey(today);
    return { year: parts?.year ?? 2026, month: parts?.month ?? 1 };
  });
  const [selected, setSelected] = useState<DayKey>(today);

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<CalEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyForm(today));

  // The grid shows days from the neighbouring months, so the fetch has to cover
  // the grid, not the month — otherwise the first and last rows would sit empty
  // while the very same day shows its events one month over.
  const range = useMemo(() => gridRange(cursor.year, cursor.month), [cursor.year, cursor.month]);
  const { data: events, loading, refetch } = useApi<CalEvent[]>(
    `/api/events?from=${range.from}&to=${range.to}`,
  );
  const { data: users } = useApi<Person[]>('/api/users');

  // A second, month-independent window: what is coming up, from today. Its path
  // does not change with `cursor`, so browsing months does not refetch it.
  const upcomingTo = addDays(today, 60);
  const { data: upcoming, refetch: refetchUpcoming } = useApi<CalEvent[]>(
    `/api/events?from=${today}&to=${upcomingTo}`,
  );

  const list = useMemo(() => events ?? [], [events]);
  const byDay = useMemo(() => eventsByDay(list, range.from, range.to), [list, range.from, range.to]);
  const weeks = useMemo(() => monthMatrix(cursor.year, cursor.month), [cursor.year, cursor.month]);

  const dayEvents = byDay.get(selected) ?? [];
  const people = users ?? [];
  const busy = loading && !events;
  const relLabel = relativeDayLabel(selected, today);

  // A new event defaults to the signed-in user — the common case for a
  // household calendar. Guarded on that id actually being in the list: a
  // MUI Select whose value matches no item renders blank and warns.
  const meId = session?.user?.id;
  const defaultOwner = meId && people.some((p) => p.id === meId) ? meId : '';

  const refresh = () => {
    refetch();
    refetchUpcoming();
  };

  /**
   * Move a month, keeping the day-of-month where possible.
   *
   * Clamped to the target month's length, so 31 January → February lands on the
   * 28th rather than spilling into March. The selection follows, so the agenda
   * never describes a day that is not on screen.
   */
  const goToMonth = (delta: number) => {
    const next = addMonths(cursor.year, cursor.month, delta);
    const day = Math.min(parseDayKey(selected)?.day ?? 1, daysInMonth(next.year, next.month));
    setCursor(next);
    setSelected(dayKey(next.year, next.month, day));
  };

  const goToToday = () => {
    const parts = parseDayKey(today);
    setCursor({ year: parts?.year ?? cursor.year, month: parts?.month ?? cursor.month });
    setSelected(today);
  };

  /** Jump to a day from the "coming up" list, following it into its month. */
  const goToDay = (key: DayKey) => {
    const parts = parseDayKey(key);
    if (!parts) return;
    setCursor({ year: parts.year, month: parts.month });
    setSelected(key);
  };

  const openCreate = (date: DayKey) => {
    setEditing(null);
    setForm({ ...emptyForm(date), userId: defaultOwner });
    setOpen(true);
  };

  const openEdit = (event: CalEvent) => {
    setEditing(event);
    setForm({
      title: event.title,
      date: keyOf(event.date),
      multiDay: isMultiDay(event),
      endDate: keyOf(event.endDate) || keyOf(event.date),
      hasTime: Boolean(event.startTime),
      startTime: event.startTime ?? '09:00',
      userId: event.user?.id ?? '',
      notes: event.notes ?? '',
    });
    setOpen(true);
  };

  const endBeforeStart = form.multiDay && Boolean(form.endDate) && form.endDate < form.date;
  const canSave = form.title.trim().length > 0 && Boolean(form.date) && !endBeforeStart;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const body = {
        title: form.title.trim(),
        date: form.date,
        // Sent explicitly rather than omitted, so turning a multi-day event back
        // into a single-day one clears the end date instead of leaving it.
        endDate: form.multiDay ? form.endDate || null : null,
        startTime: form.hasTime ? form.startTime || null : null,
        notes: form.notes.trim() || null,
        userId: form.userId || null,
      };
      if (editing) await apiPut(`/api/events/${editing.id}`, body);
      else await apiPost('/api/events', body);
      setOpen(false);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not save this event.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (event: CalEvent) => {
    const spans = isMultiDay(event);
    if (
      !confirm(
        `Delete "${event.title}"${spans ? ` (${formatDayShort(keyOf(event.date))} – ${formatDayShort(keyOf(event.endDate))})` : ` on ${formatDayShort(keyOf(event.date))}`}?\n\nThis cannot be undone.`,
      )
    ) {
      return;
    }
    try {
      await apiDelete(`/api/events/${event.id}`);
      setOpen(false);
      refresh();
    } catch (err) {
      alert(err instanceof ApiError ? err.message : 'Could not delete this event.');
    }
  };

  // "Coming up" skips anything already in the agenda for the selected day, so
  // the same event is never listed twice on screen.
  const comingUp = useMemo(() => {
    const shownIds = new Set(dayEvents.map((e) => e.id));
    return (upcoming ?? [])
      // The window already begins today, so this only drops events that have
      // finished. It compares the *last* day: `endDate` is null for a
      // single-day event, and `'' >= today` would be false.
      .filter((e) => (keyOf(e.endDate) || keyOf(e.date)) >= today && !shownIds.has(e.id))
      .slice(0, 5);
  }, [upcoming, dayEvents, today]);

  return (
    <Box>
      {/* ── Toolbar ─────────────────────────────────────── */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 2,
          mb: 2,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton onClick={() => goToMonth(-1)} aria-label="Previous month" size="small">
            <ChevronLeftIcon />
          </IconButton>
          <Typography variant="h3" fontWeight={700} sx={{ minWidth: { xs: 150, sm: 220 }, textAlign: 'center' }}>
            {formatMonth(cursor.year, cursor.month)}
          </Typography>
          <IconButton onClick={() => goToMonth(1)} aria-label="Next month" size="small">
            <ChevronRightIcon />
          </IconButton>
        </Stack>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ ml: 'auto' }}>
          <Button variant="outlined" startIcon={<TodayIcon />} onClick={goToToday}>
            Today
          </Button>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openCreate(selected)}>
            Add event
          </Button>
        </Stack>
      </Box>

      {/* Who is who — the colours are the only thing distinguishing two people's
          events at a glance, so they need a key. */}
      {people.length > 0 && (
        <Stack direction="row" spacing={2} sx={{ mb: 2, flexWrap: 'wrap', rowGap: 0.5 }}>
          {people.map((person) => (
            <Stack key={person.id} direction="row" spacing={0.75} alignItems="center">
              <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: person.color }} />
              <Typography variant="caption" color="text.secondary">
                {person.name}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}

      {/* ── Grid + agenda ───────────────────────────────── */}
      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 2fr) minmax(0, 1fr)' } }}>
        <Card>
          <CardContent sx={{ p: { xs: 1, sm: 2 }, '&:last-child': { pb: { xs: 1, sm: 2 } } }}>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
                // The gaps show the container's colour, which is how the
                // hairlines are drawn without doubled borders.
                gap: '1px',
                bgcolor: 'divider',
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              {WEEKDAY_LABELS.map((label) => (
                <Box key={label} sx={{ bgcolor: 'background.paper', py: 0.75, textAlign: 'center' }}>
                  <Typography
                    variant="caption"
                    sx={{
                      fontWeight: 700,
                      color: 'text.secondary',
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                    }}
                  >
                    {label}
                  </Typography>
                </Box>
              ))}

              {weeks.flat().map((cell) => (
                <DayCell
                  key={cell.key}
                  cell={cell}
                  events={byDay.get(cell.key) ?? []}
                  selected={cell.key === selected}
                  today={today}
                  onSelect={setSelected}
                />
              ))}
            </Box>

            {busy && (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={24} />
              </Box>
            )}
          </CardContent>
        </Card>

        <Stack spacing={2}>
          <Card>
            <CardContent>
              <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="h5">{formatDayLong(selected)}</Typography>
                  {relLabel && (
                    <Chip size="small" color="primary" label={relLabel} sx={{ mt: 0.5, fontWeight: 600 }} />
                  )}
                </Box>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => openCreate(selected)}
                  sx={{ flexShrink: 0 }}
                >
                  Add
                </Button>
              </Stack>

              <Divider sx={{ my: 1.5 }} />

              {dayEvents.length === 0 ? (
                <Stack alignItems="center" spacing={1} sx={{ py: 3, color: 'text.secondary' }}>
                  <EventBusyIcon sx={{ fontSize: 32, opacity: 0.5 }} />
                  <Typography variant="body2">Nothing on this day.</Typography>
                  <Button size="small" onClick={() => openCreate(selected)}>
                    Add an event
                  </Button>
                </Stack>
              ) : (
                dayEvents.map((event, index) => (
                  <Box key={event.id}>
                    {index > 0 && <Divider />}
                    <AgendaRow event={event} onEdit={openEdit} onDelete={handleDelete} />
                  </Box>
                ))
              )}
            </CardContent>
          </Card>

          {comingUp.length > 0 && (
            <Card>
              <CardContent>
                <Typography variant="h6" sx={{ mb: 1 }}>
                  Coming up
                </Typography>
                <Stack divider={<Divider />}>
                  {comingUp.map((event) => (
                    <Box
                      key={event.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => goToDay(keyOf(event.date))}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          goToDay(keyOf(event.date));
                        }
                      }}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 1,
                        py: 0.75,
                        px: 0.5,
                        mx: -0.5,
                        borderRadius: 1,
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' },
                      }}
                    >
                      <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: colorOf(event), flexShrink: 0 }} />
                      <Typography variant="caption" color="text.secondary" sx={{ width: 58, flexShrink: 0 }}>
                        {whenLabel(event, today)}
                      </Typography>
                      <Typography variant="body2" noWrap sx={{ minWidth: 0, flex: 1 }}>
                        {event.title}
                      </Typography>
                      {event.startTime && (
                        <Typography variant="caption" color="text.secondary" sx={{ flexShrink: 0 }}>
                          {formatTime(event.startTime)}
                        </Typography>
                      )}
                    </Box>
                  ))}
                </Stack>
              </CardContent>
            </Card>
          )}
        </Stack>
      </Box>

      {/* ── Add / edit ──────────────────────────────────── */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? 'Edit event' : 'New event'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Title"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              autoFocus
              fullWidth
              required
            />

            <TextField
              label="Date"
              type="date"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />

            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.multiDay}
                    onChange={(e) =>
                      setForm({ ...form, multiDay: e.target.checked, endDate: e.target.checked ? form.endDate || form.date : '' })
                    }
                  />
                }
                label="Runs over several days"
              />
              {form.multiDay && (
                <TextField
                  label="Last day"
                  type="date"
                  value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  sx={{ mt: 1 }}
                  error={endBeforeStart}
                  helperText={endBeforeStart ? 'The last day cannot be before the first.' : ' '}
                />
              )}
            </Box>

            <Box>
              <FormControlLabel
                control={
                  <Switch
                    checked={form.hasTime}
                    onChange={(e) => setForm({ ...form, hasTime: e.target.checked })}
                  />
                }
                label="Has a time"
              />
              {form.hasTime && (
                <TextField
                  label="Starts at"
                  type="time"
                  value={form.startTime}
                  onChange={(e) => setForm({ ...form, startTime: e.target.value })}
                  InputLabelProps={{ shrink: true }}
                  fullWidth
                  sx={{ mt: 1 }}
                />
              )}
            </Box>

            <FormControl fullWidth>
              <InputLabel>Who is it for</InputLabel>
              <Select
                value={form.userId}
                label="Who is it for"
                onChange={(e) => setForm({ ...form, userId: e.target.value })}
              >
                <MenuItem value="">
                  <em>Shared</em>
                </MenuItem>
                {people.map((person) => (
                  <MenuItem key={person.id} value={person.id}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Box sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: person.color }} />
                      {person.name}
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <TextField
              label="Notes"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          {editing && (
            <Button color="error" onClick={() => handleDelete(editing)} sx={{ mr: 'auto' }}>
              Delete
            </Button>
          )}
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={!canSave || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

/** A blank form, defaulting to the day the user clicked. */
function emptyForm(date: DayKey): FormState {
  return {
    title: '',
    date,
    multiDay: false,
    endDate: '',
    hasTime: false,
    startTime: '09:00',
    userId: '',
    notes: '',
  };
}

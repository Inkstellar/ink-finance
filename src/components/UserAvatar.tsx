import { Avatar, type SxProps, type Theme } from '@mui/material';

/** The subset of a user this component needs. */
export interface AvatarUser {
  id: string;
  name?: string | null;
  initials?: string | null;
  color?: string | null;
  hasAvatar?: boolean;
  /** Used to bust the image cache when the picture is replaced. */
  updatedAt?: string;
}

/**
 * Fired after a picture is uploaded or removed.
 *
 * The sidebar renders the signed-in user's avatar from its own `/api/users/me`
 * request, so without this it would keep showing the old picture until a
 * reload. An event beats lifting state through the whole app shell for one
 * rarely-changing value.
 */
export const AVATAR_CHANGED_EVENT = 'ink:avatar-changed';

/** URL for a user's picture, or undefined when they have none. */
export function avatarUrl(user: AvatarUser): string | undefined {
  if (!user.hasAvatar) return undefined;
  const v = user.updatedAt ? new Date(user.updatedAt).getTime() : '';
  return `/api/users/${user.id}/avatar${v ? `?v=${v}` : ''}`;
}

/**
 * A user's profile picture, falling back to their initials.
 *
 * MUI's Avatar renders its children whenever `src` is missing *or* fails to
 * load, so passing both means a deleted picture degrades to initials on its own
 * rather than showing a broken image.
 */
export default function UserAvatar({
  user,
  size = 40,
  fontSize,
  sx,
  src,
}: {
  user: AvatarUser;
  size?: number;
  fontSize?: number;
  sx?: SxProps<Theme>;
  /**
   * Override the image source — used for a not-yet-saved upload, which is a
   * data URL rather than something the API serves. `null` forces initials;
   * `undefined` falls back to the user's stored picture.
   */
  src?: string | null;
}) {
  const initials = user.initials || (user.name ?? 'U').slice(0, 1).toUpperCase();
  const resolvedSrc = src !== undefined ? src ?? undefined : avatarUrl(user);

  return (
    <Avatar
      src={resolvedSrc}
      alt={user.name ?? undefined}
      sx={{
        width: size,
        height: size,
        fontSize: fontSize ?? Math.round(size * 0.42),
        fontWeight: 700,
        bgcolor: user.color || 'primary.main',
        ...sx,
      }}
    >
      {initials}
    </Avatar>
  );
}

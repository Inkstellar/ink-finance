/**
 * Auth.js (NextAuth v5) configuration for the Express API.
 *
 * Session strategy is JWT because the Credentials provider cannot use
 * database sessions — Auth.js only persists sessions for OAuth providers.
 * The JWT is delivered as an httpOnly cookie, which means the browser must
 * treat the API as *same-origin*: see the proxy setup in vite.config.ts
 * (local) and the static-site rewrite (production). `onrender.com` is on the
 * Public Suffix List, so calling the API cross-origin would make this cookie
 * a third-party cookie and Safari would silently drop it.
 */
import Credentials from '@auth/express/providers/credentials';
import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import type { ExpressAuthConfig } from '@auth/express';

const prisma = new PrismaClient();

/** Shared secret authenticating the Telegram bot (server-to-server, no cookie). */
export const SERVICE_TOKEN = process.env.SERVICE_TOKEN ?? '';

export const authConfig: ExpressAuthConfig = {
  // `trustHost` lets Auth.js derive the origin from the forwarded headers,
  // which is required behind Render's proxy.
  trustHost: true,

  session: { strategy: 'jwt' },

  pages: {
    // The SPA owns the login UI; Auth.js should not render its own page.
    signIn: '/login',
  },

  providers: [
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email = String(credentials?.email ?? '').trim().toLowerCase();
        const password = String(credentials?.password ?? '');
        if (!email || !password) return null;

        const user = await prisma.finUser.findUnique({ where: { email } });
        // No such user, or a user created before login existed (no password
        // set) — reject identically so the response can't be used to probe
        // which emails exist.
        if (!user?.passwordHash) return null;

        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;

        return {
          id: user.id,
          name: user.name,
          email: user.email ?? undefined,
          image: user.color, // reused by the SPA as the avatar colour
          initials: user.initials,
        };
      },
    }),
  ],

  callbacks: {
    // Put the fields the SPA needs onto the token, so the session is
    // self-contained and we don't hit the database on every request.
    async jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.initials = (user as { initials?: string }).initials;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        (session.user as { id?: string }).id = token.uid as string;
        (session.user as { initials?: string }).initials = token.initials as string;
      }
      return session;
    },
  },
};

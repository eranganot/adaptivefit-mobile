/**
 * Auth.js (NextAuth v5) configuration.
 * Single-tenant lockdown — only ALLOWED_EMAIL can sign in.
 */
import NextAuth, { type DefaultSession } from "next-auth";
import Google from "next-auth/providers/google";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      locale: "en" | "he";
    } & DefaultSession["user"];
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const allowed = process.env.ALLOWED_EMAIL?.toLowerCase().trim();
      if (!allowed) return true; // No allowlist set — open mode (dev only)
      return profile?.email?.toLowerCase() === allowed;
    },
    async jwt({ token, profile }) {
      if (profile?.email) {
        // Upsert user record on first sign-in
        const existing = await db.query.users.findFirst({
          where: eq(users.email, profile.email),
        });
        if (existing) {
          token.userId = existing.id;
          token.locale = existing.locale;
        } else {
          const [created] = await db
            .insert(users)
            .values({
              email: profile.email,
              googleSub: (profile.sub as string) ?? null,
              displayName: (profile.name as string) ?? null,
            })
            .returning();
          token.userId = created.id;
          token.locale = created.locale;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (token.userId) session.user.id = token.userId as string;
      if (token.locale) session.user.locale = token.locale as "en" | "he";
      return session;
    },
  },
  pages: {
    signIn: "/sign-in",
  },
  session: { strategy: "jwt" },
});

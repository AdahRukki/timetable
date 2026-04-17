// Self-hosted authentication: Google OAuth 2.0 + email/password (bcrypt).
// File name kept as `replitAuth.ts` to preserve the existing import surface
// (`server/replit_integrations/auth/index.ts`), but contains no Replit-specific
// auth code. Designed to run on any host (e.g. a personal VPS behind Nginx).
import passport from "passport";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { Strategy as GoogleStrategy, type Profile } from "passport-google-oauth20";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcryptjs";
import type { Express, RequestHandler } from "express";
import { authStorage } from "./storage";
import type { User } from "@shared/models/auth";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week
const BCRYPT_ROUNDS = 12;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getSession() {
  const PgStore = connectPg(session);
  const sessionStore = new PgStore({
    conString: requireEnv("DATABASE_URL"),
    createTableIfMissing: false,
    ttl: SESSION_TTL_MS / 1000,
    tableName: "sessions",
  });
  return session({
    secret: requireEnv("SESSION_SECRET"),
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_TTL_MS,
    },
  });
}

async function findOrCreateGoogleUser(profile: Profile): Promise<User> {
  const googleId = profile.id;
  const email = profile.emails?.[0]?.value ?? null;
  const firstName = profile.name?.givenName ?? null;
  const lastName = profile.name?.familyName ?? null;
  const profileImageUrl = profile.photos?.[0]?.value ?? null;

  const existingByGoogle = await authStorage.getUserByGoogleId(googleId);
  if (existingByGoogle) {
    return authStorage.upsertUser({
      id: existingByGoogle.id,
      email: email ?? existingByGoogle.email,
      firstName: firstName ?? existingByGoogle.firstName,
      lastName: lastName ?? existingByGoogle.lastName,
      profileImageUrl: profileImageUrl ?? existingByGoogle.profileImageUrl,
      googleId,
    });
  }

  if (email) {
    const existingByEmail = await authStorage.getUserByEmail(email);
    if (existingByEmail) {
      return authStorage.upsertUser({
        id: existingByEmail.id,
        email,
        firstName: firstName ?? existingByEmail.firstName,
        lastName: lastName ?? existingByEmail.lastName,
        profileImageUrl: profileImageUrl ?? existingByEmail.profileImageUrl,
        googleId,
      });
    }
  }

  return authStorage.createUser({
    email,
    firstName,
    lastName,
    profileImageUrl,
    googleId,
  });
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  // Local (email + password) strategy
  passport.use(
    new LocalStrategy(
      { usernameField: "email", passwordField: "password" },
      async (email, password, done) => {
        try {
          const normalizedEmail = email.trim().toLowerCase();
          const user = await authStorage.getUserByEmail(normalizedEmail);
          if (!user || !user.passwordHash) {
            return done(null, false, { message: "Invalid email or password" });
          }
          const ok = await bcrypt.compare(password, user.passwordHash);
          if (!ok) {
            return done(null, false, { message: "Invalid email or password" });
          }
          return done(null, { id: user.id });
        } catch (err) {
          return done(err as Error);
        }
      }
    )
  );

  // Google OAuth strategy (only registered if credentials are configured)
  const googleClientId = process.env.GOOGLE_CLIENT_ID;
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const appUrl = process.env.APP_URL;

  if (googleClientId && googleClientSecret && appUrl) {
    passport.use(
      new GoogleStrategy(
        {
          clientID: googleClientId,
          clientSecret: googleClientSecret,
          callbackURL: `${appUrl.replace(/\/$/, "")}/api/auth/google/callback`,
        },
        async (_accessToken, _refreshToken, profile, done) => {
          try {
            const user = await findOrCreateGoogleUser(profile);
            return done(null, { id: user.id });
          } catch (err) {
            return done(err as Error);
          }
        }
      )
    );

    app.get(
      "/api/auth/google",
      passport.authenticate("google", { scope: ["profile", "email"] })
    );

    app.get(
      "/api/auth/google/callback",
      passport.authenticate("google", {
        failureRedirect: "/?auth_error=google",
      }),
      (_req, res) => {
        res.redirect("/");
      }
    );

    // Backwards-compatible entry point used by the landing page button
    app.get("/api/login", (_req, res) => {
      res.redirect("/api/auth/google");
    });
  } else {
    // No Google configured — /api/login surfaces a clear message
    app.get("/api/login", (_req, res) => {
      res
        .status(503)
        .send(
          "Google login is not configured on this server. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and APP_URL."
        );
    });
  }

  // Email/password registration
  app.post("/api/auth/register", async (req, res, next) => {
    try {
      const { email, password, firstName, lastName } = req.body ?? {};
      if (typeof email !== "string" || typeof password !== "string") {
        return res.status(400).json({ message: "Email and password are required" });
      }
      const normalizedEmail = email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        return res.status(400).json({ message: "Invalid email address" });
      }
      if (password.length < 8) {
        return res.status(400).json({ message: "Password must be at least 8 characters" });
      }
      const existing = await authStorage.getUserByEmail(normalizedEmail);
      if (existing) {
        return res.status(409).json({ message: "An account with that email already exists" });
      }
      const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
      const user = await authStorage.createUser({
        email: normalizedEmail,
        firstName: typeof firstName === "string" ? firstName : null,
        lastName: typeof lastName === "string" ? lastName : null,
        passwordHash,
      });
      req.login({ id: user.id }, (err) => {
        if (err) return next(err);
        const { passwordHash: _ph, ...safe } = user;
        res.status(201).json(safe);
      });
    } catch (err) {
      next(err);
    }
  });

  // Email/password login
  app.post("/api/auth/login", (req, res, next) => {
    passport.authenticate(
      "local",
      (err: Error | null, user: { id: string } | false, info: { message?: string } | undefined) => {
        if (err) return next(err);
        if (!user) {
          return res.status(401).json({ message: info?.message ?? "Invalid email or password" });
        }
        req.login(user, async (loginErr) => {
          if (loginErr) return next(loginErr);
          const fullUser = await authStorage.getUser(user.id);
          if (!fullUser) return res.status(500).json({ message: "User not found after login" });
          const { passwordHash: _ph, ...safe } = fullUser;
          res.json(safe);
        });
      }
    )(req, res, next);
  });

  // Logout (used by both UI button and legacy /api/logout link)
  const handleLogout: RequestHandler = (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie("connect.sid");
        if (req.method === "GET") return res.redirect("/");
        res.json({ ok: true });
      });
    });
  };
  app.get("/api/logout", handleLogout);
  app.post("/api/logout", handleLogout);

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser((user: Express.User, cb) => cb(null, user));
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  if (req.isAuthenticated() && req.user && (req.user as { id?: string }).id) {
    return next();
  }
  return res.status(401).json({ message: "Unauthorized" });
};

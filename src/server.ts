import express from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import csurf from "csurf";
import rateLimit from "express-rate-limit";
import { env } from "./env.js";
import { auth } from "./auth.js";
import { toNodeHandler } from "better-auth/node";
import adminUsersRouter from "./routes/adminUsers.js";
import { fromNodeHeaders } from "better-auth/node";
import { db } from "./db/index.js";
import { userPackage, userProfile } from "./db/schema.js";
import { eq } from "drizzle-orm";
import publicAuthRouter from "./routes/publicAuth.js";
import pointsRouter from "./routes/points.js";
import { checkLockout, recordAttempt } from "./middleware/loginLockout.js";
import packagesRouter from "./routes/packages.js";
import adminPackagesRouter from "./routes/adminPackages.js";
import { requireAdmin } from "./middleware/requireAdmin.js";
import adminQuestionsRouter from "./routes/adminQuestions.js";
import adminLatsolRouter from "./routes/adminLatsol.js";
import supportTicketsRouter from "./routes/supportTickets.js";
import adminSupportTicketsRouter from "./routes/adminSupportTickets.js";
import profileRouter from "./routes/profile.js";
import promoBannerRouter from "./routes/promoBanner.js";
import adminPromoBannerRouter from "./routes/adminPromoBanner.js";
import adminOverviewRouter from "./routes/adminOverview.js";
import adminTransactionsRouter from "./routes/adminTransactions.js";
import featureTogglesRouter from "./routes/featureToggles.js";
import adminFeatureTogglesRouter from "./routes/adminFeatureToggles.js";
import latsolRouter from "./routes/latsol.js";
import paymentsRouter from "./routes/payments.js";
import adminPaymentMethodsRouter from "./routes/adminPaymentMethods.js";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

process.on("unhandledRejection", (reason) => {
  // Keep process alive and surface async SDK bootstrap errors in logs.
  // eslint-disable-next-line no-console
  console.error("[BE] Unhandled Rejection:", reason);
});

const app = express();

const uploadsDir = join(process.cwd(), "uploads", "promo-banner");
try {
  mkdirSync(uploadsDir, { recursive: true });
} catch {
  // ignore
}

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false
  })
);
app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true
  })
);

// Pre-handler for login lockout (needs JSON body)
app.post("/api/auth/sign-in/email", express.json(), async (req, res) => {
  const email = (req.body?.email || "").toString().trim().toLowerCase();
  if (email) {
    const lock = await checkLockout(email);
    if (lock.locked) {
      return res.status(423).json({
        message: "Akun sementara diblokir karena terlalu banyak percobaan login.",
        retryAt: lock.retryAt
      });
    }
  }

  await toNodeHandler(auth)(req, res);

  if (email) {
    const setCookie = res.getHeader("set-cookie");
    const cookies = Array.isArray(setCookie) ? setCookie.join(";") : String(setCookie || "");
    const hasSessionCookie = cookies.includes("better-auth.session_token");
    const success = res.statusCode >= 200 && res.statusCode < 300 && hasSessionCookie;
    await recordAttempt(email, success);
  }
});

// Better Auth handler should be mounted before body parsing for other routes
app.all("/api/auth/*", toNodeHandler(auth));

app.use(express.json());
app.use(cookieParser());

const csrfProtection = csurf({
  cookie: {
    httpOnly: true,
    sameSite: "lax"
  }
});

// CSRF for non-auth endpoints
app.use((req, res, next) => {
  if (req.path.startsWith("/api/auth/")) return next();
  if (req.path.startsWith("/api/payments/doku/webhook")) return next();
  // Dev helper: allow testing DOKU endpoints via Postman without CSRF token.
  // Keep CSRF enforced for these paths in production.
  if (process.env.NODE_ENV !== "production" && req.path.startsWith("/api/payments/doku/")) {
    return next();
  }
  return csrfProtection(req, res, next);
});

app.get("/api/csrf", (req, res) => {
  res.json({ csrfToken: req.csrfToken() });
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false
});

app.use("/api/public/signup", authLimiter);
app.use("/api/auth/sign-in", authLimiter);

app.use("/api/public", publicAuthRouter);
app.use("/api/points", pointsRouter);
app.use("/api/packages", packagesRouter);
app.use("/api/features", featureTogglesRouter);
app.use("/api/support", supportTicketsRouter);
app.use("/api/profile", profileRouter);
app.use("/api/promo-banner", promoBannerRouter);
app.use("/api/latsol", latsolRouter);
app.use("/api/payments", paymentsRouter);
app.use("/uploads", express.static(join(process.cwd(), "uploads")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "bumn-master-system-be",
    time: new Date().toISOString()
  });
});

app.get("/api/me", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Pragma", "no-cache");
  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const profile = await db
    .select({
      role: userProfile.role,
      status: userProfile.status,
      targetBumn: userProfile.targetBumn,
      phone: userProfile.phone,
      points: userProfile.points
    })
    .from(userProfile)
    .where(eq(userProfile.userId, session.user.id))
    .limit(1);

  if (profile.length === 0) {
    await db
      .insert(userProfile)
      .values({
        userId: session.user.id,
        role: "user",
        status: "active",
        points: 0
      })
      .onConflictDoNothing();
  }

  const profile2 = profile.length
    ? profile
    : await db
        .select({
          role: userProfile.role,
          status: userProfile.status,
          targetBumn: userProfile.targetBumn,
          phone: userProfile.phone,
          points: userProfile.points
        })
        .from(userProfile)
        .where(eq(userProfile.userId, session.user.id))
        .limit(1);

  const p = profile2[0];

  if (p?.status === "blocked") {
    return res.status(403).json({ message: "Akun Anda diblokir." });
  }

  const packageRows = await db
    .select({ packageId: userPackage.packageId })
    .from(userPackage)
    .where(eq(userPackage.userId, session.user.id));

  const packageIds = packageRows.map((r) => r.packageId);

  return res.json({
    user: session.user,
    session: session.session,
    profile: {
      role: p?.role ?? "user",
      status: p?.status ?? "active",
      targetBumn: p?.targetBumn ?? null,
      phone: p?.phone ?? null,
      points: p?.points ?? 0
    },
    packages: packageIds
  });
});

app.use("/api/admin", requireAdmin);
app.use("/api/admin/users", adminUsersRouter);
app.use("/api/admin/packages", adminPackagesRouter);
app.use("/api/admin/questions", adminQuestionsRouter);
app.use("/api/admin/latsol", adminLatsolRouter);
app.use("/api/admin/support", adminSupportTicketsRouter);
app.use("/api/admin/promo-banner", adminPromoBannerRouter);
app.use("/api/admin/overview", adminOverviewRouter);
app.use("/api/admin/transactions", adminTransactionsRouter);
app.use("/api/admin/features", adminFeatureTogglesRouter);
app.use("/api/admin/payment-methods", adminPaymentMethodsRouter);

app.listen(env.PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[BE] Listening on http://localhost:${env.PORT}`);
});

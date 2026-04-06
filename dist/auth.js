import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db/index.js";
import * as schema from "./db/schema.js";
import { env } from "./env.js";
export const auth = betterAuth({
    database: drizzleAdapter(db, {
        provider: "sqlite",
        schema
    }),
    baseURL: env.BETTER_AUTH_URL,
    secret: env.SESSION_SECRET,
    trustedOrigins: env.CORS_ORIGIN,
    advanced: {
        // Render + FE localhost is cross-site, so session cookie must be SameSite=None; Secure.
        // For pure local HTTP dev we keep lax/non-secure.
        useSecureCookies: process.env.NODE_ENV === "production" || env.BETTER_AUTH_URL.startsWith("https://"),
        defaultCookieAttributes: {
            sameSite: process.env.NODE_ENV === "production" || env.BETTER_AUTH_URL.startsWith("https://")
                ? "none"
                : "lax",
            secure: process.env.NODE_ENV === "production" || env.BETTER_AUTH_URL.startsWith("https://")
        },
        trustedProxyHeaders: true
    },
    emailAndPassword: {
        enabled: true
    }
});

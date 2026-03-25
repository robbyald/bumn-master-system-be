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
    emailAndPassword: {
        enabled: true
    }
});

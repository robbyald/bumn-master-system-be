import "dotenv/config";

const rawOrigins = process.env.CORS_ORIGIN || "http://localhost:5173";
const corsOrigins = rawOrigins.split(",").map((s) => s.trim()).filter(Boolean);

export const env = {
  PORT: Number(process.env.PORT || 8080),
  DATABASE_URL: process.env.DATABASE_URL || "./data/app.db",
  BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || "http://localhost:8080",
  SESSION_SECRET: process.env.SESSION_SECRET || "dev-secret-change-me",
  CORS_ORIGIN: corsOrigins,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || "",
  OPENAI_MODEL: process.env.OPENAI_MODEL || "",
  OPENAI_VISION_MODEL: process.env.OPENAI_VISION_MODEL || process.env.OPENAI_MODEL || "",
  OPENAI_IMAGE_MODEL: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1-mini",
  OPENAI_VALIDATOR_MODEL: process.env.OPENAI_VALIDATOR_MODEL || process.env.OPENAI_MODEL || "",
  APP_BASE_URL: process.env.APP_BASE_URL || "http://localhost:3000",
  DOKU_CLIENT_ID: process.env.DOKU_CLIENT_ID || "",
  DOKU_SECRET_KEY: process.env.DOKU_SECRET_KEY || "",
  DOKU_PRIVATE_KEY: process.env.DOKU_PRIVATE_KEY || "",
  DOKU_PUBLIC_KEY: process.env.DOKU_PUBLIC_KEY || "",
  DOKU_PUBLIC_KEY_DOKU: process.env.DOKU_PUBLIC_KEY_DOKU || "",
  DOKU_ISSUER: process.env.DOKU_ISSUER || "",
  DOKU_CHANNEL: process.env.DOKU_CHANNEL || "DIRECT_DEBIT_BRI_SNAP",
  DOKU_ENV: process.env.DOKU_ENV || "sandbox",
  DOKU_ACK_COMPAT_2500: String(process.env.DOKU_ACK_COMPAT_2500 || "").toLowerCase() === "true"
};

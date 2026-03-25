import { db } from "../db/index.js";
import { loginAttempt } from "../db/schema.js";
import { eq, sql } from "drizzle-orm";
const MAX_FAILED = 5;
const LOCK_MINUTES = 3;
export async function checkLockout(email) {
    const now = Date.now();
    const existing = await db
        .select({ failedCount: loginAttempt.failedCount, lockedUntil: loginAttempt.lockedUntil })
        .from(loginAttempt)
        .where(eq(loginAttempt.email, email))
        .limit(1);
    const lockedUntil = existing[0]?.lockedUntil ?? null;
    const lockedUntilMs = lockedUntil instanceof Date ? lockedUntil.getTime() : lockedUntil;
    if (lockedUntilMs && lockedUntilMs > now) {
        return { locked: true, lockedUntil: lockedUntilMs, retryAt: new Date(lockedUntilMs).toISOString() };
    }
    if (lockedUntilMs && lockedUntilMs <= now) {
        await db
            .update(loginAttempt)
            .set({ failedCount: 0, lockedUntil: null })
            .where(eq(loginAttempt.email, email));
    }
    return { locked: false, lockedUntil: null, retryAt: null };
}
export async function recordAttempt(email, success) {
    try {
        if (success) {
            await db
                .insert(loginAttempt)
                .values({ email, failedCount: 0, lockedUntil: null, updatedAt: new Date() })
                .onConflictDoUpdate({
                target: loginAttempt.email,
                set: { failedCount: 0, lockedUntil: null, updatedAt: sql `(cast(unixepoch('subsecond') * 1000 as integer))` }
            });
            return;
        }
        const lockMs = LOCK_MINUTES * 60 * 1000;
        await db
            .insert(loginAttempt)
            .values({
            email,
            failedCount: 1,
            lockedUntil: MAX_FAILED <= 1 ? new Date(Date.now() + lockMs) : null,
            updatedAt: new Date()
        })
            .onConflictDoUpdate({
            target: loginAttempt.email,
            set: {
                failedCount: sql `${loginAttempt.failedCount} + 1`,
                lockedUntil: sql `case when ${loginAttempt.failedCount} + 1 >= ${MAX_FAILED} then (cast(unixepoch('subsecond') * 1000 as integer) + ${lockMs}) else ${loginAttempt.lockedUntil} end`,
                updatedAt: sql `(cast(unixepoch('subsecond') * 1000 as integer))`
            }
        });
    }
    catch {
        // ignore lockout logging errors
    }
}

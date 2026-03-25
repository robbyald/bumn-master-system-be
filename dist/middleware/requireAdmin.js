import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../auth.js";
import { db } from "../db/index.js";
import { userProfile } from "../db/schema.js";
import { eq } from "drizzle-orm";
export async function requireAdmin(req, res, next) {
    const session = await auth.api.getSession({
        headers: fromNodeHeaders(req.headers)
    });
    if (!session || !session.user) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    const profile = await db
        .select({ role: userProfile.role, status: userProfile.status })
        .from(userProfile)
        .where(eq(userProfile.userId, session.user.id))
        .limit(1);
    const role = profile[0]?.role ?? "user";
    const status = profile[0]?.status ?? "active";
    if (status !== "active") {
        return res.status(403).json({ message: "User is blocked" });
    }
    if (role !== "admin") {
        return res.status(403).json({ message: "Forbidden" });
    }
    res.locals.session = session.session;
    res.locals.user = session.user;
    return next();
}

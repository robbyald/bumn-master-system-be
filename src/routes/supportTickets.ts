import { Router } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db } from "../db/index.js";
import { supportTicket } from "../db/schema.js";
import { auth } from "../auth.js";
import { fromNodeHeaders } from "better-auth/node";
import { eq } from "drizzle-orm";

const router = Router();

const createSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  message: z.string().min(10)
});

router.post("/tickets", async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid body", issues: parsed.error.issues });
  }

  const session = await auth.api.getSession({
    headers: fromNodeHeaders(req.headers)
  });

  if (!session || !session.user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const id = randomUUID();
  const ticketNo = `CS-${id.slice(0, 5).toUpperCase()}`;
  const { name, email, message } = parsed.data;

  await db.insert(supportTicket).values({
    id,
    ticketNo,
    userId: session.user.id,
    name,
    email,
    message,
    status: "open"
  });

  return res.status(201).json({ id, ticketNo });
});

export default router;

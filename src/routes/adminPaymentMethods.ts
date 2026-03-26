import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db/index.js";
import { paymentGatewayConfig, paymentMethodConfig } from "../db/schema.js";

const router = Router();

router.get("/", async (_req, res) => {
  const gatewayRows = await db
    .select({ mode: paymentGatewayConfig.mode })
    .from(paymentGatewayConfig)
    .where(eq(paymentGatewayConfig.id, "doku"))
    .limit(1);

  const methods = await db
    .select()
    .from(paymentMethodConfig)
    .orderBy(paymentMethodConfig.sortOrder);

  return res.json({
    mode: gatewayRows[0]?.mode || "sandbox",
    methods,
  });
});

const saveSchema = z.object({
  mode: z.enum(["sandbox", "production"]),
  methods: z.array(
    z.object({
      id: z.string().min(1),
      displayName: z.string().min(1),
      isVisible: z.boolean(),
      sandboxPartnerServiceId: z.string().min(1),
      sandboxCustomerNo: z.string().min(1),
      sandboxChannel: z.string().min(1),
      productionPartnerServiceId: z.string().optional().default(""),
      productionCustomerNo: z.string().optional().default(""),
      productionChannel: z.string().optional().default(""),
      sortOrder: z.number().int().optional(),
    }),
  ),
});

router.put("/", async (req, res) => {
  const parsed = saveSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ message: "Payload tidak valid.", detail: parsed.error.flatten() });
  }

  const now = new Date();

  await db
    .insert(paymentGatewayConfig)
    .values({ id: "doku", provider: "doku", mode: parsed.data.mode, updatedAt: now })
    .onConflictDoUpdate({
      target: paymentGatewayConfig.id,
      set: { mode: parsed.data.mode, updatedAt: now },
    });

  for (const m of parsed.data.methods) {
    await db
      .update(paymentMethodConfig)
      .set({
        displayName: m.displayName,
        isVisible: m.isVisible,
        sandboxPartnerServiceId: m.sandboxPartnerServiceId,
        sandboxCustomerNo: m.sandboxCustomerNo,
        sandboxChannel: m.sandboxChannel,
        productionPartnerServiceId: m.productionPartnerServiceId || "",
        productionCustomerNo: m.productionCustomerNo || "",
        productionChannel: m.productionChannel || "",
        sortOrder: m.sortOrder ?? 0,
        updatedAt: now,
      })
      .where(eq(paymentMethodConfig.id, m.id));
  }

  return res.json({ ok: true, message: "Konfigurasi payment method berhasil disimpan." });
});

export default router;

import { relations, sql } from "drizzle-orm";
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const user = sqliteTable("user", {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    emailVerified: integer("email_verified", { mode: "boolean" })
        .default(false)
        .notNull(),
    image: text("image"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
});
export const userProfile = sqliteTable("user_profile", {
    userId: text("user_id")
        .primaryKey()
        .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("user"),
    status: text("status").notNull().default("active"),
    targetBumn: text("target_bumn"),
    phone: text("phone"),
    points: integer("points").notNull().default(0),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [index("user_profile_userId_idx").on(table.userId)]);
export const userPackage = sqliteTable("user_package", {
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    packageId: text("package_id").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
}, (table) => [
    index("user_package_userId_idx").on(table.userId),
    index("user_package_packageId_idx").on(table.packageId),
]);
export const userPointHistory = sqliteTable("user_point_history", {
    id: text("id").primaryKey(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    amount: integer("amount").notNull(),
    type: text("type").notNull(), // 'earn' | 'spend'
    description: text("description").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
}, (table) => [
    index("user_point_history_userId_idx").on(table.userId),
    index("user_point_history_createdAt_idx").on(table.createdAt),
]);
export const loginAttempt = sqliteTable("login_attempt", {
    email: text("email").primaryKey(),
    failedCount: integer("failed_count").notNull().default(0),
    lockedUntil: integer("locked_until", { mode: "timestamp_ms" }),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [index("login_attempt_lockedUntil_idx").on(table.lockedUntil)]);
export const examPackage = sqliteTable("exam_package", {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    price: integer("price").notNull(),
    durationMinutes: integer("duration_minutes").notNull(),
    categories: text("categories").notNull(), // JSON array
    totalQuestions: integer("total_questions").notNull(),
    type: text("type").notNull(), // 'tryout' | 'learning'
    isPopular: integer("is_popular", { mode: "boolean" }).default(false).notNull(),
    educationLevel: text("education_level").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [
    index("exam_package_type_idx").on(table.type),
    index("exam_package_popular_idx").on(table.isPopular),
]);
export const questionBank = sqliteTable("question_bank", {
    id: text("id").primaryKey(),
    category: text("category").notNull(),
    subcategory: text("subcategory").notNull(),
    difficulty: text("difficulty").notNull(),
    usageType: text("usage_type").notNull().default("practice"),
    question: text("question").notNull(),
    options: text("options").notNull(), // JSON array
    correctAnswer: text("correct_answer"),
    explanation: text("explanation"),
    source: text("source").notNull().default("goldset"),
    status: text("status").notNull().default("draft"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [
    index("question_bank_category_idx").on(table.category),
    index("question_bank_subcategory_idx").on(table.subcategory),
    index("question_bank_difficulty_idx").on(table.difficulty),
]);
export const questionUsage = sqliteTable("question_usage", {
    id: text("id").primaryKey(),
    questionId: text("question_id").notNull(),
    setId: text("set_id"),
    userId: text("user_id"),
    usedAt: integer("used_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
}, (table) => [
    index("question_usage_questionId_idx").on(table.questionId),
    index("question_usage_setId_idx").on(table.setId),
    index("question_usage_userId_idx").on(table.userId),
    index("question_usage_usedAt_idx").on(table.usedAt),
]);
export const supportTicket = sqliteTable("support_ticket", {
    id: text("id").primaryKey(),
    ticketNo: text("ticket_no").notNull(),
    userId: text("user_id"),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("open"),
    closedAt: integer("closed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [
    index("support_ticket_ticketNo_idx").on(table.ticketNo),
    index("support_ticket_status_idx").on(table.status),
    index("support_ticket_createdAt_idx").on(table.createdAt),
]);
export const latsolSet = sqliteTable("latsol_set", {
    id: text("id").primaryKey(),
    categoryId: text("category_id").notNull(),
    category: text("category").notNull(), // TKD | AKHLAK | TBI | OTHERS
    subcategory: text("subcategory").notNull(),
    title: text("title").notNull(),
    totalQuestions: integer("total_questions").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    isPremium: integer("is_premium", { mode: "boolean" }).notNull().default(false),
    isPublished: integer("is_published", { mode: "boolean" }).notNull().default(false),
    featureCode: text("feature_code"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [
    index("latsol_set_categoryId_idx").on(table.categoryId),
    index("latsol_set_category_idx").on(table.category),
    index("latsol_set_subcategory_idx").on(table.subcategory),
]);
export const latsolSetQuestion = sqliteTable("latsol_set_question", {
    id: text("id").primaryKey(),
    setId: text("set_id").notNull(),
    questionId: text("question_id").notNull(),
    order: integer("order").notNull(),
}, (table) => [
    index("latsol_set_question_setId_idx").on(table.setId),
    index("latsol_set_question_questionId_idx").on(table.questionId),
]);
export const latsolProgress = sqliteTable("latsol_progress", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    setId: text("set_id").notNull(),
    categoryId: text("category_id").notNull(),
    score: integer("score"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: integer("last_attempt_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [
    index("latsol_progress_userId_idx").on(table.userId),
    index("latsol_progress_setId_idx").on(table.setId),
    index("latsol_progress_categoryId_idx").on(table.categoryId),
]);
export const packageFeature = sqliteTable("package_feature", {
    id: text("id").primaryKey(),
    packageId: text("package_id").notNull(),
    featureCode: text("feature_code").notNull(),
}, (table) => [
    index("package_feature_packageId_idx").on(table.packageId),
    index("package_feature_featureCode_idx").on(table.featureCode),
]);
export const userFeature = sqliteTable("user_feature", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    featureCode: text("feature_code").notNull(),
}, (table) => [
    index("user_feature_userId_idx").on(table.userId),
    index("user_feature_featureCode_idx").on(table.featureCode),
]);
export const promoBanner = sqliteTable("promo_banner", {
    id: text("id").primaryKey(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    type: text("type").notNull().default("text"), // 'text' | 'image'
    title: text("title"),
    message: text("message"),
    code: text("code"),
    ctaText: text("cta_text"),
    ctaLink: text("cta_link"),
    imageUrl: text("image_url"),
    version: text("version").notNull().default("v1"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [index("promo_banner_enabled_idx").on(table.enabled)]);
export const paymentOrder = sqliteTable("payment_order", {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    packageId: text("package_id").notNull(),
    provider: text("provider").notNull().default("doku"),
    externalOrderNo: text("external_order_no").notNull(),
    externalInvoiceNo: text("external_invoice_no"),
    amount: integer("amount").notNull(),
    status: text("status").notNull().default("pending"), // pending | paid | failed | expired | cancelled
    paymentUrl: text("payment_url"),
    rawResponse: text("raw_response"),
    rawCallback: text("raw_callback"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [
    index("payment_order_userId_idx").on(table.userId),
    index("payment_order_packageId_idx").on(table.packageId),
    index("payment_order_status_idx").on(table.status),
    index("payment_order_externalOrderNo_idx").on(table.externalOrderNo),
]);
export const featureToggle = sqliteTable("feature_toggle", {
    id: text("id").primaryKey(),
    tryout: integer("tryout", { mode: "boolean" }).notNull().default(true),
    catalog: integer("catalog", { mode: "boolean" }).notNull().default(true),
    leaderboard: integer("leaderboard", { mode: "boolean" }).notNull().default(true),
    materials: integer("materials", { mode: "boolean" }).notNull().default(true),
    dailyChallenge: integer("daily_challenge", { mode: "boolean" }).notNull().default(true),
    payment: integer("payment", { mode: "boolean" }).notNull().default(true),
    maintenance: integer("maintenance", { mode: "boolean" }).notNull().default(false),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
});
export const session = sqliteTable("session", {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
}, (table) => [index("session_userId_idx").on(table.userId)]);
export const account = sqliteTable("account", {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
        .notNull()
        .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
        mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
        mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [index("account_userId_idx").on(table.userId)]);
export const verification = sqliteTable("verification", {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
        .default(sql `(cast(unixepoch('subsecond') * 1000 as integer))`)
        .$onUpdate(() => /* @__PURE__ */ new Date())
        .notNull(),
}, (table) => [index("verification_identifier_idx").on(table.identifier)]);
export const userRelations = relations(user, ({ many, one }) => ({
    sessions: many(session),
    accounts: many(account),
    profile: one(userProfile, {
        fields: [user.id],
        references: [userProfile.userId],
    }),
}));
export const sessionRelations = relations(session, ({ one }) => ({
    user: one(user, {
        fields: [session.userId],
        references: [user.id],
    }),
}));
export const accountRelations = relations(account, ({ one }) => ({
    user: one(user, {
        fields: [account.userId],
        references: [user.id],
    }),
}));

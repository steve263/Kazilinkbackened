require('dotenv').config();
const { execSync } = require('child_process');
const { Client } = require('pg');

async function applyDirectMigrations() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  console.log('[pre-deploy] Connected to database. Applying direct migrations...');

  const safeQuery = async (label, sql, params = []) => {
    try {
      await client.query(sql, params);
      console.log(`[pre-deploy] OK: ${label}`);
    } catch (e) {
      console.error(`[pre-deploy] SKIP (${label}): ${e.message}`);
    }
  };

  // ── Enums ──────────────────────────────────────────────────────────────────

  await safeQuery(
    'BookingStatus DISPUTED',
    `ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'DISPUTED'`
  );

  await safeQuery(
    'CommissionStatus enum',
    `DO $$ BEGIN
       CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'WAIVED');
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`
  );

  await safeQuery(
    'CommissionStatus PENDING_VERIFICATION',
    `ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION'`
  );

  await safeQuery(
    'PaymentStatus enum',
    `DO $$ BEGIN
       CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED', 'CASH');
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`
  );

  await safeQuery('PaymentStatus PENDING',              `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING'`);
  await safeQuery('PaymentStatus FAILED',               `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'FAILED'`);
  await safeQuery('PaymentStatus CASH',                 `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CASH'`);
  await safeQuery('PaymentStatus REFUND_REQUESTED',     `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REFUND_REQUESTED'`);
  await safeQuery('PaymentStatus NOT_REQUIRED',         `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'NOT_REQUIRED'`);
  await safeQuery('PaymentStatus PAY_AT_VENUE',         `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PAY_AT_VENUE'`);
  await safeQuery('PaymentStatus CASH_OR_MPESA',        `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CASH_OR_MPESA'`);
  await safeQuery('PaymentStatus PENDING_VERIFICATION', `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION'`);

  await safeQuery(
    'SubscriptionPlan enum',
    `DO $$ BEGIN
       CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'GROWTH', 'PREMIUM');
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`
  );

  await safeQuery(
    'SubscriptionStatus enum',
    `DO $$ BEGIN
       CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`
  );

  // ── Booking columns ────────────────────────────────────────────────────────

  const bookingCols = [
    [`Booking.paymentMethod`,       `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paymentMethod"       TEXT            NOT NULL DEFAULT 'MPESA'`],
    [`Booking.customerConfirmed`,   `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "customerConfirmed"   BOOLEAN         NOT NULL DEFAULT false`],
    [`Booking.customerConfirmedAt`, `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3)`],
    [`Booking.paymentReleasedAt`,   `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paymentReleasedAt"   TIMESTAMP(3)`],
    [`Booking.completedByProvider`, `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "completedByProvider" TIMESTAMP(3)`],
    [`Booking.cashPaid`,            `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cashPaid"            BOOLEAN         NOT NULL DEFAULT false`],
    [`Booking.cashPaidAt`,          `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cashPaidAt"          TIMESTAMP(3)`],
    [`Booking.acceptedAt`,          `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "acceptedAt"          TIMESTAMP(3)`],
    [`Booking.jobPhotos`,           `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "jobPhotos"           TEXT            NOT NULL DEFAULT '[]'`],
  ];

  for (const [label, sql] of bookingCols) {
    await safeQuery(label, sql);
  }

  await safeQuery(
    'Booking paymentMethod backfill BUSINESS_DIRECT',
    `UPDATE "Booking" b
     SET "paymentMethod" = 'BUSINESS_DIRECT'
     FROM "Provider" p
     WHERE b."providerId" = p.id
       AND p.category != 'FUNDI'
       AND b."paymentMethod" = 'MPESA'`
  );

  // ── Provider columns ───────────────────────────────────────────────────────

  const providerCols = [
    [`Provider.walletBalance`,      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "walletBalance"      DOUBLE PRECISION NOT NULL DEFAULT 0`],
    [`Provider.totalEarned`,        `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "totalEarned"        DOUBLE PRECISION NOT NULL DEFAULT 0`],
    [`Provider.isBusy`,             `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "isBusy"             BOOLEAN          NOT NULL DEFAULT false`],
    [`Provider.busySince`,          `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "busySince"          TIMESTAMP(3)`],
    [`Provider.avgResponseMinutes`, `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "avgResponseMinutes" INTEGER`],
    [`Provider.providerWorkPhotos`, `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "providerWorkPhotos" TEXT             NOT NULL DEFAULT '[]'`],
  ];

  for (const [label, sql] of providerCols) {
    await safeQuery(label, sql);
  }

  // ── Subscription backfill ─────────────────────────────────────────────────

  await safeQuery(
    'Subscription backfill trial for businesses',
    `INSERT INTO "Subscription" (
       "id", "providerId", "plan", "status",
       "trialStartDate", "trialEndDate", "createdAt", "updatedAt"
     )
     SELECT
       gen_random_uuid()::text,
       p.id,
       'STARTER',
       'TRIAL',
       NOW(),
       NOW() + INTERVAL '14 days',
       NOW(),
       NOW()
     FROM "Provider" p
     WHERE p.category != 'FUNDI'
       AND p.id NOT IN (SELECT "providerId" FROM "Subscription")`
  );

  // ── Subscription columns ──────────────────────────────────────────────────

  const subscriptionCols = [
    [`Subscription.currentPeriodStart`, `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3)`],
    [`Subscription.currentPeriodEnd`,   `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd"   TIMESTAMP(3)`],
    [`Subscription.amount`,             `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "amount"             DOUBLE PRECISION`],
    [`Subscription.mpesaRef`,           `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "mpesaRef"           TEXT`],
    [`Subscription.autoRenew`,          `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "autoRenew"          BOOLEAN NOT NULL DEFAULT true`],
    [`Subscription.updatedAt`,          `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW()`],
  ];

  for (const [label, sql] of subscriptionCols) {
    await safeQuery(label, sql);
  }

  // ── SubscriptionPayment table ──────────────────────────────────────────────

  await safeQuery(
    'SubscriptionPayment table',
    `CREATE TABLE IF NOT EXISTS "SubscriptionPayment" (
       "id"             TEXT             NOT NULL,
       "subscriptionId" TEXT             NOT NULL,
       "amount"         DOUBLE PRECISION NOT NULL,
       "mpesaRef"       TEXT,
       "phone"          TEXT             NOT NULL DEFAULT '',
       "status"         TEXT             NOT NULL DEFAULT 'PENDING',
       "paidAt"         TIMESTAMP(3),
       "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
       CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
     )`
  );

  const subPaymentCols = [
    [`SubscriptionPayment.mpesaRef`, `ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "mpesaRef" TEXT`],
    [`SubscriptionPayment.phone`,    `ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "phone"    TEXT NOT NULL DEFAULT ''`],
    [`SubscriptionPayment.paidAt`,   `ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "paidAt"   TIMESTAMP(3)`],
  ];

  for (const [label, sql] of subPaymentCols) {
    await safeQuery(label, sql);
  }

  // ── OutstandingCommission table ────────────────────────────────────────────

  await safeQuery(
    'OutstandingCommission table',
    `CREATE TABLE IF NOT EXISTS "OutstandingCommission" (
       "id"                TEXT          NOT NULL,
       "bookingId"         TEXT          NOT NULL,
       "providerId"        TEXT          NOT NULL,
       "amount"            DOUBLE PRECISION NOT NULL DEFAULT 0,
       "status"            "CommissionStatus" NOT NULL DEFAULT 'PENDING',
       "mpesaRef"          TEXT,
       "checkoutRequestId" TEXT,
       "dueAt"             TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
       "paidAt"            TIMESTAMP(3),
       "waivedAt"          TIMESTAMP(3),
       "waivedBy"          TEXT,
       "waiveReason"       TEXT,
       "createdAt"         TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
       "updatedAt"         TIMESTAMP(3)  NOT NULL DEFAULT NOW(),
       CONSTRAINT "OutstandingCommission_pkey" PRIMARY KEY ("id")
     )`
  );

  const commissionCols = [
    [`OutstandingCommission.amount`,            `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "amount"            DOUBLE PRECISION NOT NULL DEFAULT 0`],
    [`OutstandingCommission.cashAmount`,        `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "cashAmount"        DOUBLE PRECISION NOT NULL DEFAULT 0`],
    [`OutstandingCommission.commissionAmount`,  `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "commissionAmount"  DOUBLE PRECISION NOT NULL DEFAULT 0`],
    [`OutstandingCommission.reminderCount`,     `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "reminderCount"     INTEGER          NOT NULL DEFAULT 0`],
    [`OutstandingCommission.status`,            `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "status"            "CommissionStatus" NOT NULL DEFAULT 'PENDING'`],
    [`OutstandingCommission.mpesaRef`,          `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "mpesaRef"          TEXT`],
    [`OutstandingCommission.checkoutRequestId`, `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "checkoutRequestId" TEXT`],
    [`OutstandingCommission.dueAt`,             `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "dueAt"             TIMESTAMP(3) NOT NULL DEFAULT NOW()`],
    [`OutstandingCommission.paidAt`,            `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "paidAt"            TIMESTAMP(3)`],
    [`OutstandingCommission.waivedAt`,          `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "waivedAt"          TIMESTAMP(3)`],
    [`OutstandingCommission.waivedBy`,          `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "waivedBy"          TEXT`],
    [`OutstandingCommission.waiveReason`,       `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "waiveReason"       TEXT`],
    [`OutstandingCommission.createdAt`,         `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW()`],
    [`OutstandingCommission.updatedAt`,         `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW()`],
  ];

  // Set defaults on columns that may already exist in production without them
  await safeQuery('OutstandingCommission.cashAmount default',       `ALTER TABLE "OutstandingCommission" ALTER COLUMN "cashAmount"       SET DEFAULT 0`);
  await safeQuery('OutstandingCommission.commissionAmount default',  `ALTER TABLE "OutstandingCommission" ALTER COLUMN "commissionAmount"  SET DEFAULT 0`);
  await safeQuery('OutstandingCommission.amount default',            `ALTER TABLE "OutstandingCommission" ALTER COLUMN "amount"            SET DEFAULT 0`);
  await safeQuery('OutstandingCommission.reminderCount default',     `ALTER TABLE "OutstandingCommission" ALTER COLUMN "reminderCount"     SET DEFAULT 0`);

  for (const [label, sql] of commissionCols) {
    await safeQuery(label, sql);
  }

  await safeQuery(
    'OutstandingCommission bookingId unique constraint',
    `DO $$ BEGIN
       ALTER TABLE "OutstandingCommission" ADD CONSTRAINT "OutstandingCommission_bookingId_key" UNIQUE ("bookingId");
     EXCEPTION WHEN duplicate_object THEN NULL;
     END $$`
  );

  // ── AppSettings table ──────────────────────────────────────────────────────

  await safeQuery(
    'AppSettings table',
    `CREATE TABLE IF NOT EXISTS "AppSettings" (
       "id"        TEXT         NOT NULL,
       "settings"  TEXT         NOT NULL,
       "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
       "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
       CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
     )`
  );

  await client.end();
  console.log('[pre-deploy] All migrations attempted.');
}

async function main() {
  console.log('[pre-deploy] ===== KaziShow pre-deploy starting =====');

  try {
    await applyDirectMigrations();
  } catch (err) {
    console.error('[pre-deploy] Fatal connection error:', err.message);
  }

  console.log('[pre-deploy] Running prisma db push...');
  try {
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    console.log('[pre-deploy] prisma db push complete');
  } catch (err) {
    console.error('[pre-deploy] db push failed (non-fatal):', err.message);
    console.log('[pre-deploy] Continuing server startup despite db push failure...');
  }

  console.log('[pre-deploy] ===== Pre-deploy complete =====');
}

main();

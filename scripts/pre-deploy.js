require('dotenv').config();
const { execSync } = require('child_process');
const { Client } = require('pg');

async function applyDirectMigrations() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    console.log('[pre-deploy] Connected to database. Applying direct migrations...');

    // ── Enums ──────────────────────────────────────────────────────────────────

    // Add DISPUTED to BookingStatus — must run outside a transaction on older PG
    await client.query(`ALTER TYPE "BookingStatus" ADD VALUE IF NOT EXISTS 'DISPUTED';`);

    // Create CommissionStatus enum if it doesn't exist yet
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'PAID', 'OVERDUE', 'WAIVED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Add PENDING_VERIFICATION to CommissionStatus (manual Paybill flow)
    await client.query(`ALTER TYPE "CommissionStatus" ADD VALUE IF NOT EXISTS 'PENDING_VERIFICATION';`);

    // Add CASH to PaymentStatus (cash payment method)
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'REFUNDED', 'CASH');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);
    await client.query(`ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CASH';`);

    // Create SubscriptionPlan enum if it doesn't exist yet
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "SubscriptionPlan" AS ENUM ('STARTER', 'GROWTH', 'PREMIUM');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    // Create SubscriptionStatus enum if it doesn't exist yet
    await client.query(`
      DO $$ BEGIN
        CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    console.log('[pre-deploy] Enums ready');

    // ── Booking columns ────────────────────────────────────────────────────────

    const bookingCols = [
      // paymentMethod stored as TEXT (not enum) — avoids PostgreSQL type creation issues
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paymentMethod"       TEXT            NOT NULL DEFAULT 'MPESA'`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "customerConfirmed"   BOOLEAN         NOT NULL DEFAULT false`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "customerConfirmedAt" TIMESTAMP(3)`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "paymentReleasedAt"   TIMESTAMP(3)`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "completedByProvider" TIMESTAMP(3)`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cashPaid"            BOOLEAN         NOT NULL DEFAULT false`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "cashPaidAt"          TIMESTAMP(3)`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "acceptedAt"          TIMESTAMP(3)`,
      `ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS "jobPhotos"           TEXT            NOT NULL DEFAULT '[]'`,
    ];

    for (const sql of bookingCols) {
      await client.query(sql);
    }

    // Backfill non-FUNDI bookings to BUSINESS_DIRECT
    await client.query(`
      UPDATE "Booking" b
      SET "paymentMethod" = 'BUSINESS_DIRECT'
      FROM "Provider" p
      WHERE b."providerId" = p.id
        AND p.category != 'FUNDI'
        AND b."paymentMethod" = 'MPESA'
    `);

    console.log('[pre-deploy] Booking columns ready');

    // ── Provider columns ───────────────────────────────────────────────────────

    const providerCols = [
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "totalEarned"   DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "isBusy"               BOOLEAN          NOT NULL DEFAULT false`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "busySince"            TIMESTAMP(3)`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "avgResponseMinutes"   INTEGER`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "providerWorkPhotos"   TEXT            NOT NULL DEFAULT '[]'`,
    ];

    for (const sql of providerCols) {
      await client.query(sql);
    }
    console.log('[pre-deploy] Provider columns ready');

    // ── Backfill: give existing businesses a free trial if they have no subscription ─

    await client.query(`
      INSERT INTO "Subscription" (
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
        AND p.id NOT IN (SELECT "providerId" FROM "Subscription")
    `);

    console.log('[pre-deploy] Subscription backfill complete');

    // ── Subscription table — ensure all columns exist ──────────────────────────
    const subscriptionCols = [
      `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodStart" TIMESTAMP(3)`,
      `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "currentPeriodEnd"   TIMESTAMP(3)`,
      `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "amount"             DOUBLE PRECISION`,
      `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "mpesaRef"           TEXT`,
      `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "autoRenew"          BOOLEAN NOT NULL DEFAULT true`,
      `ALTER TABLE "Subscription" ADD COLUMN IF NOT EXISTS "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW()`,
    ];
    for (const sql of subscriptionCols) {
      await client.query(sql);
    }
    console.log('[pre-deploy] Subscription columns ready');

    // ── SubscriptionPayment table — ensure all columns exist ───────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS "SubscriptionPayment" (
        "id"             TEXT             NOT NULL,
        "subscriptionId" TEXT             NOT NULL,
        "amount"         DOUBLE PRECISION NOT NULL,
        "mpesaRef"       TEXT,
        "phone"          TEXT             NOT NULL DEFAULT '',
        "status"         TEXT             NOT NULL DEFAULT 'PENDING',
        "paidAt"         TIMESTAMP(3),
        "createdAt"      TIMESTAMP(3)     NOT NULL DEFAULT NOW(),
        CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
      );
    `);
    const subPaymentCols = [
      `ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "mpesaRef" TEXT`,
      `ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "phone"    TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE "SubscriptionPayment" ADD COLUMN IF NOT EXISTS "paidAt"   TIMESTAMP(3)`,
    ];
    for (const sql of subPaymentCols) {
      await client.query(sql);
    }
    console.log('[pre-deploy] SubscriptionPayment columns ready');

    // ── OutstandingCommission columns ──────────────────────────────────────────
    // Table may exist from an older migration without all columns — add them safely

    await client.query(`
      CREATE TABLE IF NOT EXISTS "OutstandingCommission" (
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
      );
    `);

    const commissionCols = [
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "amount"            DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "status"            "CommissionStatus" NOT NULL DEFAULT 'PENDING'`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "mpesaRef"          TEXT`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "checkoutRequestId" TEXT`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "dueAt"             TIMESTAMP(3)`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "paidAt"            TIMESTAMP(3)`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "waivedAt"          TIMESTAMP(3)`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "waivedBy"          TEXT`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "waiveReason"       TEXT`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW()`,
      `ALTER TABLE "OutstandingCommission" ADD COLUMN IF NOT EXISTS "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW()`,
    ];

    for (const sql of commissionCols) {
      await client.query(sql);
    }

    // Unique constraint on bookingId
    await client.query(`
      DO $$ BEGIN
        ALTER TABLE "OutstandingCommission" ADD CONSTRAINT "OutstandingCommission_bookingId_key" UNIQUE ("bookingId");
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$;
    `);

    console.log('[pre-deploy] OutstandingCommission columns ready');

    // ── AppSettings table ──────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS "AppSettings" (
        "id"        TEXT         NOT NULL,
        "settings"  TEXT         NOT NULL,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
        CONSTRAINT "AppSettings_pkey" PRIMARY KEY ("id")
      );
    `);
    console.log('[pre-deploy] AppSettings table ready');

  } catch (err) {
    console.error('[pre-deploy] Direct migration error (non-fatal):', err.message);
  } finally {
    await client.end();
  }
}

async function main() {
  console.log('[pre-deploy] ===== KaziShow pre-deploy starting =====');

  await applyDirectMigrations();

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

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
    ];

    for (const sql of bookingCols) {
      await client.query(sql);
    }
    console.log('[pre-deploy] Booking columns ready');

    // ── Provider columns ───────────────────────────────────────────────────────

    const providerCols = [
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "walletBalance" DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "totalEarned"   DOUBLE PRECISION NOT NULL DEFAULT 0`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "isBusy"        BOOLEAN          NOT NULL DEFAULT false`,
      `ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "busySince"     TIMESTAMP(3)`,
    ];

    for (const sql of providerCols) {
      await client.query(sql);
    }
    console.log('[pre-deploy] Provider columns ready');

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
    console.error('[pre-deploy] db push failed:', err.message);
    process.exit(1);
  }

  console.log('[pre-deploy] ===== Pre-deploy complete =====');
}

main();

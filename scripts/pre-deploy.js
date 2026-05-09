require('dotenv').config();
const { execSync } = require('child_process');
const { Client } = require('pg');

const MIGRATION_NAME = '20260510100000_add_trust_fraud_system';

async function fixDatabase() {
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    console.log('[pre-deploy] No DATABASE_URL found — skipping DB fix.');
    return;
  }

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const client = new Client({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    console.log('[pre-deploy] Connecting to database...');
    await client.connect();
    console.log('[pre-deploy] Connected.');

    // Step 1: Mark the failed migration as rolled back
    const r1 = await client.query(
      `UPDATE "_prisma_migrations"
       SET "rolled_back_at" = NOW()
       WHERE "migration_name" = $1
       AND "finished_at" IS NULL`,
      [MIGRATION_NAME]
    );
    console.log(`[pre-deploy] Step 1 — Marked failed migration as rolled back (${r1.rowCount} rows updated).`);

    // Step 2: Drop any partially created trust tables
    const drops = [
      `DROP TABLE IF EXISTS "TrustScore" CASCADE`,
      `DROP TABLE IF EXISTS "Report" CASCADE`,
      `DROP TABLE IF EXISTS "FraudAlert" CASCADE`,
      `DROP TABLE IF EXISTS "VerificationRequest" CASCADE`,
      `DROP TYPE IF EXISTS "TrustLevel" CASCADE`,
      `DROP TYPE IF EXISTS "ReportType" CASCADE`,
      `DROP TYPE IF EXISTS "ReportStatus" CASCADE`,
      `DROP TYPE IF EXISTS "FraudType" CASCADE`,
      `DROP TYPE IF EXISTS "FraudSeverity" CASCADE`,
      `DROP TYPE IF EXISTS "VerificationType" CASCADE`,
    ];

    for (const sql of drops) {
      await client.query(sql);
    }
    console.log('[pre-deploy] Step 2 — Dropped any partial trust tables and enums.');

  } catch (err) {
    console.log('[pre-deploy] DB fix note:', err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  console.log('[pre-deploy] ===== KaziShow pre-deploy script starting =====');

  await fixDatabase();

  console.log('[pre-deploy] Step 3 — Running prisma migrate deploy...');
  try {
    execSync('npx prisma migrate deploy', { stdio: 'inherit' });
    console.log('[pre-deploy] All migrations applied successfully.');
  } catch (err) {
    console.error('[pre-deploy] migrate deploy failed:', err.message);
    process.exit(1);
  }

  console.log('[pre-deploy] ===== Pre-deploy complete =====');
}

main();

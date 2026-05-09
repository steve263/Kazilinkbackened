require('dotenv').config();
const { execSync } = require('child_process');
const { Client } = require('pg');

const MIGRATION_NAME = '20260510100000_add_trust_fraud_system';

async function main() {
  console.log('[pre-deploy] Starting...');

  // Use direct URL (bypasses PgBouncer) if available, else fall back to DATABASE_URL
  const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
  console.log('[pre-deploy] Connecting to DB...');

  const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
  const client = new Client({
    connectionString,
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('[pre-deploy] Connected. Clearing failed migration record...');

    const res = await client.query(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL`,
      [MIGRATION_NAME]
    );

    if (res.rowCount > 0) {
      console.log(`[pre-deploy] Cleared ${res.rowCount} failed migration record(s) for: ${MIGRATION_NAME}`);
    } else {
      console.log('[pre-deploy] No failed migration record found — already clean.');
    }
  } catch (err) {
    console.log('[pre-deploy] DB step note:', err.message);
  } finally {
    await client.end().catch(() => {});
  }

  console.log('[pre-deploy] Running prisma migrate deploy...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  console.log('[pre-deploy] Done.');
}

main().catch((err) => {
  console.error('[pre-deploy] Fatal:', err.message);
  process.exit(1);
});

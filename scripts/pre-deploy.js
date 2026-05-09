const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const FAILED_MIGRATION = '20260510100000_add_trust_fraud_system';

async function main() {
  const prisma = new PrismaClient();
  try {
    // Directly delete the failed migration row so prisma migrate deploy can re-run it
    const deleted = await prisma.$executeRawUnsafe(
      `DELETE FROM "_prisma_migrations" WHERE migration_name = $1 AND finished_at IS NULL`,
      FAILED_MIGRATION
    );
    if (deleted > 0) {
      console.log(`[pre-deploy] Cleared failed migration record: ${FAILED_MIGRATION}`);
    } else {
      console.log('[pre-deploy] No failed migration record found — nothing to clear.');
    }
  } catch (err) {
    console.log('[pre-deploy] Migration table check skipped:', err.message);
  } finally {
    await prisma.$disconnect();
  }

  console.log('[pre-deploy] Running prisma migrate deploy...');
  execSync('npx prisma migrate deploy', { stdio: 'inherit' });
  console.log('[pre-deploy] Done.');
}

main().catch((err) => {
  console.error('[pre-deploy] Fatal error:', err.message);
  process.exit(1);
});

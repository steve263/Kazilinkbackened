const { execSync } = require('child_process');

const FAILED_MIGRATION = '20260510100000_add_trust_fraud_system';

// Step 1: resolve the failed migration so prisma migrate deploy can proceed
try {
  console.log(`[pre-deploy] Resolving failed migration: ${FAILED_MIGRATION}`);
  execSync(`npx prisma migrate resolve --rolled-back ${FAILED_MIGRATION}`, { stdio: 'inherit' });
  console.log('[pre-deploy] Migration resolved successfully.');
} catch {
  console.log('[pre-deploy] Nothing to resolve (migration not in failed state).');
}

// Step 2: run migrate deploy
console.log('[pre-deploy] Running prisma migrate deploy...');
execSync('npx prisma migrate deploy', { stdio: 'inherit' });
console.log('[pre-deploy] Done.');

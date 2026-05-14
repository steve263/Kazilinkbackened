require('dotenv').config();
const { execSync } = require('child_process');

async function main() {
  console.log('[pre-deploy] ===== KaziShow pre-deploy script starting =====');

  console.log('[pre-deploy] Running prisma migrate deploy...');
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

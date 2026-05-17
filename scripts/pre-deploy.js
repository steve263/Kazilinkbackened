require('dotenv').config();
const { execSync } = require('child_process');

async function main() {
  console.log('[pre-deploy] ===== KaziShow pre-deploy script starting =====');

  console.log('[pre-deploy] Running prisma db push...');
  try {
    execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
    console.log('[pre-deploy] Schema pushed successfully.');
  } catch (err) {
    console.error('[pre-deploy] db push failed:', err.message);
    process.exit(1);
  }

  console.log('[pre-deploy] ===== Pre-deploy complete =====');
}

main();

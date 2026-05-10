-- Change all trust-related foreign keys from RESTRICT to CASCADE
-- so deleting a user automatically removes their trust data

-- TrustScore
ALTER TABLE "TrustScore" DROP CONSTRAINT IF EXISTS "TrustScore_userId_fkey";
ALTER TABLE "TrustScore" ADD CONSTRAINT "TrustScore_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Report (reporter side)
ALTER TABLE "Report" DROP CONSTRAINT IF EXISTS "Report_reporterId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey"
  FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Report (reported side)
ALTER TABLE "Report" DROP CONSTRAINT IF EXISTS "Report_reportedId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey"
  FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FraudAlert
ALTER TABLE "FraudAlert" DROP CONSTRAINT IF EXISTS "FraudAlert_userId_fkey";
ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- VerificationRequest
ALTER TABLE "VerificationRequest" DROP CONSTRAINT IF EXISTS "VerificationRequest_userId_fkey";
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SuspensionAppeal
ALTER TABLE "SuspensionAppeal" DROP CONSTRAINT IF EXISTS "SuspensionAppeal_userId_fkey";
ALTER TABLE "SuspensionAppeal" ADD CONSTRAINT "SuspensionAppeal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

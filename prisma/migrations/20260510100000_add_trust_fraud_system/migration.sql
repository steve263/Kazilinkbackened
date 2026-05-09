-- CreateEnum
CREATE TYPE IF NOT EXISTS "TrustLevel" AS ENUM ('NEW', 'BASIC', 'TRUSTED', 'VERIFIED', 'ELITE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE IF NOT EXISTS "ReportType" AS ENUM ('FAKE_PROVIDER', 'NO_SHOW', 'POOR_QUALITY', 'OVERCHARGING', 'HARASSMENT', 'FAKE_REVIEWS', 'PAYMENT_FRAUD', 'IMPERSONATION', 'SCAM', 'OTHER');

-- CreateEnum
CREATE TYPE IF NOT EXISTS "ReportStatus" AS ENUM ('PENDING', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE IF NOT EXISTS "FraudType" AS ENUM ('MULTIPLE_ACCOUNTS', 'FAKE_REVIEWS', 'PAYMENT_MANIPULATION', 'SUSPICIOUS_BOOKINGS', 'REPEATED_CANCELLATIONS', 'IDENTITY_MISMATCH', 'UNUSUAL_ACTIVITY');

-- CreateEnum
CREATE TYPE IF NOT EXISTS "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE IF NOT EXISTS "VerificationType" AS ENUM ('PHONE', 'NATIONAL_ID', 'FACE', 'BUSINESS', 'ADDRESS');

-- AlterTable: add isSuspended to User (safe, additive only)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "isSuspended" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable TrustScore
CREATE TABLE IF NOT EXISTS "TrustScore" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "level" "TrustLevel" NOT NULL DEFAULT 'NEW',
    "totalReports" INTEGER NOT NULL DEFAULT 0,
    "falseReports" INTEGER NOT NULL DEFAULT 0,
    "completedJobs" INTEGER NOT NULL DEFAULT 0,
    "cancelledJobs" INTEGER NOT NULL DEFAULT 0,
    "noShowCount" INTEGER NOT NULL DEFAULT 0,
    "latePayments" INTEGER NOT NULL DEFAULT 0,
    "verifiedPhone" BOOLEAN NOT NULL DEFAULT false,
    "verifiedId" BOOLEAN NOT NULL DEFAULT false,
    "verifiedFace" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrustScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable Report
CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reportedId" TEXT NOT NULL,
    "type" "ReportType" NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "bookingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable FraudAlert
CREATE TABLE IF NOT EXISTS "FraudAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "FraudType" NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "FraudSeverity" NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FraudAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable VerificationRequest
CREATE TABLE IF NOT EXISTS "VerificationRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "VerificationType" NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
    "documents" TEXT[],
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TrustScore_userId_key" ON "TrustScore"("userId");

-- AddForeignKey (safe with IF NOT EXISTS pattern via DO block)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TrustScore_userId_fkey') THEN
    ALTER TABLE "TrustScore" ADD CONSTRAINT "TrustScore_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_reporterId_fkey') THEN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Report_reportedId_fkey') THEN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey" FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'FraudAlert_userId_fkey') THEN
    ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationRequest_userId_fkey') THEN
    ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- CreateEnum TrustLevel (safe for any PG version)
DO $$ BEGIN
    CREATE TYPE "TrustLevel" AS ENUM ('NEW', 'BASIC', 'TRUSTED', 'VERIFIED', 'ELITE', 'SUSPENDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum ReportType
DO $$ BEGIN
    CREATE TYPE "ReportType" AS ENUM ('FAKE_PROVIDER', 'NO_SHOW', 'POOR_QUALITY', 'OVERCHARGING', 'HARASSMENT', 'FAKE_REVIEWS', 'PAYMENT_FRAUD', 'IMPERSONATION', 'SCAM', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum ReportStatus
DO $$ BEGIN
    CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'INVESTIGATING', 'RESOLVED', 'DISMISSED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum FraudType
DO $$ BEGIN
    CREATE TYPE "FraudType" AS ENUM ('MULTIPLE_ACCOUNTS', 'FAKE_REVIEWS', 'PAYMENT_MANIPULATION', 'SUSPICIOUS_BOOKINGS', 'REPEATED_CANCELLATIONS', 'IDENTITY_MISMATCH', 'UNUSUAL_ACTIVITY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum FraudSeverity
DO $$ BEGIN
    CREATE TYPE "FraudSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum VerificationType
DO $$ BEGIN
    CREATE TYPE "VerificationType" AS ENUM ('PHONE', 'NATIONAL_ID', 'FACE', 'BUSINESS', 'ADDRESS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable: add isSuspended (IF NOT EXISTS is fine for ALTER TABLE in PG 9.6+)
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

-- AddForeignKeys (idempotent via DO blocks)
DO $$ BEGIN
    ALTER TABLE "TrustScore" ADD CONSTRAINT "TrustScore_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey"
        FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "Report" ADD CONSTRAINT "Report_reportedId_fkey"
        FOREIGN KEY ("reportedId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "FraudAlert" ADD CONSTRAINT "FraudAlert_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

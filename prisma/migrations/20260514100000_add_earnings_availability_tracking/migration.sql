-- Add providerAmount and commission to Payment
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "providerAmount" DOUBLE PRECISION;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "commission" DOUBLE PRECISION;

-- PayoutStatus enum
DO $$ BEGIN
  CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'APPROVED', 'PROCESSING', 'COMPLETED', 'REJECTED');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ProviderAvailability
CREATE TABLE IF NOT EXISTS "ProviderAvailability" (
  "id"           TEXT NOT NULL,
  "providerId"   TEXT NOT NULL,
  "monday"       BOOLEAN NOT NULL DEFAULT true,
  "tuesday"      BOOLEAN NOT NULL DEFAULT true,
  "wednesday"    BOOLEAN NOT NULL DEFAULT true,
  "thursday"     BOOLEAN NOT NULL DEFAULT true,
  "friday"       BOOLEAN NOT NULL DEFAULT true,
  "saturday"     BOOLEAN NOT NULL DEFAULT false,
  "sunday"       BOOLEAN NOT NULL DEFAULT false,
  "startTime"    TEXT NOT NULL DEFAULT '08:00',
  "endTime"      TEXT NOT NULL DEFAULT '18:00',
  "slotDuration" INTEGER NOT NULL DEFAULT 60,
  "breakStart"   TEXT,
  "breakEnd"     TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderAvailability_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderAvailability_providerId_key" ON "ProviderAvailability"("providerId");
ALTER TABLE "ProviderAvailability"
  DROP CONSTRAINT IF EXISTS "ProviderAvailability_providerId_fkey",
  ADD CONSTRAINT "ProviderAvailability_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AvailabilityException
CREATE TABLE IF NOT EXISTS "AvailabilityException" (
  "id"             TEXT NOT NULL,
  "availabilityId" TEXT NOT NULL,
  "date"           TIMESTAMP(3) NOT NULL,
  "isAvailable"    BOOLEAN NOT NULL DEFAULT false,
  "reason"         TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AvailabilityException_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "AvailabilityException"
  DROP CONSTRAINT IF EXISTS "AvailabilityException_availabilityId_fkey",
  ADD CONSTRAINT "AvailabilityException_availabilityId_fkey"
    FOREIGN KEY ("availabilityId") REFERENCES "ProviderAvailability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payout
CREATE TABLE IF NOT EXISTS "Payout" (
  "id"          TEXT NOT NULL,
  "providerId"  TEXT NOT NULL,
  "amount"      DOUBLE PRECISION NOT NULL,
  "phone"       TEXT NOT NULL,
  "status"      "PayoutStatus" NOT NULL DEFAULT 'PENDING',
  "mpesaRef"    TEXT,
  "adminNote"   TEXT,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "Payout"
  DROP CONSTRAINT IF EXISTS "Payout_providerId_fkey",
  ADD CONSTRAINT "Payout_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ProviderLocation
CREATE TABLE IF NOT EXISTS "ProviderLocation" (
  "id"         TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "lat"        DOUBLE PRECISION NOT NULL,
  "lng"        DOUBLE PRECISION NOT NULL,
  "heading"    DOUBLE PRECISION,
  "speed"      DOUBLE PRECISION,
  "updatedAt"  TIMESTAMP(3) NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProviderLocation_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderLocation_providerId_key" ON "ProviderLocation"("providerId");
ALTER TABLE "ProviderLocation"
  DROP CONSTRAINT IF EXISTS "ProviderLocation_providerId_fkey",
  ADD CONSTRAINT "ProviderLocation_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- UserInteraction
CREATE TABLE IF NOT EXISTS "UserInteraction" (
  "id"         TEXT NOT NULL,
  "userId"     TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "type"       TEXT NOT NULL,
  "count"      INTEGER NOT NULL DEFAULT 1,
  "lastAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserInteraction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "UserInteraction_userId_providerId_type_key"
  ON "UserInteraction"("userId", "providerId", "type");
ALTER TABLE "UserInteraction"
  DROP CONSTRAINT IF EXISTS "UserInteraction_userId_fkey",
  ADD CONSTRAINT "UserInteraction_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInteraction"
  DROP CONSTRAINT IF EXISTS "UserInteraction_providerId_fkey",
  ADD CONSTRAINT "UserInteraction_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

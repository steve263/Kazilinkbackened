-- CreateEnum AppealStatus
DO $$ BEGIN
    CREATE TYPE "AppealStatus" AS ENUM ('PENDING', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'MORE_INFO_NEEDED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable SuspensionAppeal
CREATE TABLE IF NOT EXISTS "SuspensionAppeal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "suspensionReason" TEXT NOT NULL DEFAULT '',
    "appealReason" TEXT NOT NULL,
    "explanation" TEXT NOT NULL,
    "evidence" TEXT[] NOT NULL DEFAULT '{}',
    "contactPhone" TEXT NOT NULL,
    "contactEmail" TEXT,
    "status" "AppealStatus" NOT NULL DEFAULT 'PENDING',
    "adminNote" TEXT,
    "reviewedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "SuspensionAppeal_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "SuspensionAppeal" ADD CONSTRAINT "SuspensionAppeal_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Migration: add referralCode/totalRewards to User, isBusy/busySince to Provider,
-- ProviderWaitlist, Promotion, Referral, Reward tables and all related enums.
-- All statements use IF NOT EXISTS / DO $$ BEGIN ... EXCEPTION so it is idempotent.

-- ─── Enums ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "ReferralStatus" AS ENUM ('PENDING', 'REGISTERED', 'COMPLETED', 'REWARDED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RewardType" AS ENUM ('REFERRAL_BONUS', 'FIRST_BOOKING_DISCOUNT', 'LOYALTY_BONUS', 'PROMO_CODE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "RewardStatus" AS ENUM ('PENDING', 'ACTIVE', 'USED', 'EXPIRED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TipStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TestimonialStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── User: missing columns ─────────────────────────────────────────────────────

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "totalRewards" DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

-- ─── Provider: busy status ────────────────────────────────────────────────────

ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "isBusy" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "busySince" TIMESTAMP(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "isFeatured" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "badge" TEXT;

-- ─── ProviderWaitlist ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "ProviderWaitlist" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "serviceId" TEXT,
    "notified" BOOLEAN NOT NULL DEFAULT false,
    "notifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProviderWaitlist_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ProviderWaitlist_providerId_customerId_notified_key"
    ON "ProviderWaitlist"("providerId", "customerId", "notified");

DO $$ BEGIN
  ALTER TABLE "ProviderWaitlist" ADD CONSTRAINT "ProviderWaitlist_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ProviderWaitlist" ADD CONSTRAINT "ProviderWaitlist_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Promotion ───────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Promotion" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "DiscountType" NOT NULL DEFAULT 'PERCENTAGE',
    "discountValue" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Referral ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT NOT NULL,
    "referredId" TEXT,
    "code" TEXT NOT NULL,
    "status" "ReferralStatus" NOT NULL DEFAULT 'PENDING',
    "rewardAmount" DOUBLE PRECISION NOT NULL DEFAULT 200,
    "discountAmount" DOUBLE PRECISION NOT NULL DEFAULT 100,
    "rewardPaid" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Referral_code_key" ON "Referral"("code");

DO $$ BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerId_fkey"
    FOREIGN KEY ("referrerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referredId_fkey"
    FOREIGN KEY ("referredId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Reward ──────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Reward" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "RewardType" NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "description" TEXT NOT NULL,
    "status" "RewardStatus" NOT NULL DEFAULT 'PENDING',
    "referralId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Reward" ADD CONSTRAINT "Reward_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Tip ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Tip" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "coverImage" TEXT,
    "category" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "status" "TipStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectReason" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "readTime" INTEGER NOT NULL DEFAULT 5,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tip_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Tip" ADD CONSTRAINT "Tip_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── TipComment ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "TipComment" (
    "id" TEXT NOT NULL,
    "tipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TipComment_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "TipComment" ADD CONSTRAINT "TipComment_tipId_fkey"
    FOREIGN KEY ("tipId") REFERENCES "Tip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TipComment" ADD CONSTRAINT "TipComment_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── Testimonial: add missing columns ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "Testimonial" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "providerId" TEXT,
    "videoUrl" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "summary" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "status" "TestimonialStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Testimonial_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Testimonial" ADD CONSTRAINT "Testimonial_providerId_fkey"
    FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Add imageUrl, originalPrice, bookingCount to Promotion table
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "originalPrice" INTEGER;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "bookingCount" INTEGER NOT NULL DEFAULT 0;

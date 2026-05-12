-- Add imageUrl and originalPrice columns to Promotion table
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "imageUrl" TEXT;
ALTER TABLE "Promotion" ADD COLUMN IF NOT EXISTS "originalPrice" INTEGER;

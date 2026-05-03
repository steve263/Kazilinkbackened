-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "coverImage" TEXT,
ADD COLUMN     "idPhotoUrl" TEXT,
ADD COLUMN     "profileImage" TEXT,
ADD COLUMN     "selfieUrl" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "profilePhoto" TEXT;

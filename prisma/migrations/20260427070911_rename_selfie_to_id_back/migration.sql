/*
  Warnings:

  - You are about to drop the column `selfieUrl` on the `Provider` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Provider" DROP COLUMN "selfieUrl",
ADD COLUMN     "idBackPhotoUrl" TEXT;

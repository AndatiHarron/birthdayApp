-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'BIRTHDAY_CHEER';

-- AlterTable
ALTER TABLE "birthday_messages" ADD COLUMN     "fromStranger" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "digital_gifts" ADD COLUMN     "fromStranger" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "privacy_settings" ADD COLUMN     "celebrateGlobally" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "celebrationNote" TEXT,
ADD COLUMN     "firstCelebration" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "birthday_cheers" (
    "id" TEXT NOT NULL,
    "fromUserId" TEXT NOT NULL,
    "toUserId" TEXT NOT NULL,
    "celebrationYear" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '🎉',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "birthday_cheers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "birthday_cheers_toUserId_celebrationYear_idx" ON "birthday_cheers"("toUserId", "celebrationYear");

-- CreateIndex
CREATE INDEX "birthday_cheers_fromUserId_createdAt_idx" ON "birthday_cheers"("fromUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "birthday_cheers_fromUserId_toUserId_celebrationYear_key" ON "birthday_cheers"("fromUserId", "toUserId", "celebrationYear");

-- AddForeignKey
ALTER TABLE "birthday_cheers" ADD CONSTRAINT "birthday_cheers_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "birthday_cheers" ADD CONSTRAINT "birthday_cheers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "gift_orders" ADD COLUMN     "addressFromRecipient" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "privacy_settings" ADD COLUMN     "publicGifting" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicPage" BOOLEAN NOT NULL DEFAULT false;

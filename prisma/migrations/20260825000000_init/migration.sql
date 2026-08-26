-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "CreationStatus" AS ENUM ('DRAFT', 'PUBLISHED');

-- CreateEnum
CREATE TYPE "PurchaseState" AS ENUM ('ACTIVE', 'REFUNDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RsvpAnswer" AS ENUM ('YES', 'NO', 'MAYBE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefreshToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RefreshToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DraftSession" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "claimedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DraftSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Creation" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "status" "CreationStatus" NOT NULL DEFAULT 'DRAFT',
    "data" JSONB NOT NULL,
    "ownerUserId" TEXT,
    "draftSessionId" TEXT,
    "shareCode" TEXT,
    "coverImageId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Creation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Image" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "draftSessionId" TEXT,
    "creationId" TEXT,
    "keyFull" TEXT NOT NULL,
    "keyThumb" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Purchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "creationId" TEXT NOT NULL,
    "rcTransactionId" TEXT NOT NULL,
    "rcAppUserId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "tierKey" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "priceMinorUnits" BIGINT,
    "currency" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "state" "PurchaseState" NOT NULL DEFAULT 'ACTIVE',
    "raw" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RsvpResponse" (
    "id" TEXT NOT NULL,
    "creationId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "attending" "RsvpAnswer" NOT NULL,
    "guestCount" INTEGER NOT NULL DEFAULT 1,
    "message" TEXT,
    "contactPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RsvpResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViewDaily" (
    "creationId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ViewDaily_pkey" PRIMARY KEY ("creationId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSub_key" ON "User"("googleSub");

-- CreateIndex
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RefreshToken_tokenHash_key" ON "RefreshToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");

-- CreateIndex
CREATE INDEX "RefreshToken_familyId_idx" ON "RefreshToken"("familyId");

-- CreateIndex
CREATE INDEX "RefreshToken_expiresAt_idx" ON "RefreshToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DraftSession_tokenHash_key" ON "DraftSession"("tokenHash");

-- CreateIndex
CREATE INDEX "DraftSession_claimedByUserId_idx" ON "DraftSession"("claimedByUserId");

-- CreateIndex
CREATE INDEX "DraftSession_lastSeenAt_idx" ON "DraftSession"("lastSeenAt");

-- CreateIndex
CREATE UNIQUE INDEX "Creation_shareCode_key" ON "Creation"("shareCode");

-- CreateIndex
CREATE INDEX "Creation_ownerUserId_updatedAt_idx" ON "Creation"("ownerUserId", "updatedAt");

-- CreateIndex
CREATE INDEX "Creation_draftSessionId_idx" ON "Creation"("draftSessionId");

-- CreateIndex
CREATE INDEX "Creation_expiresAt_idx" ON "Creation"("expiresAt");

-- CreateIndex
CREATE INDEX "Creation_status_expiresAt_idx" ON "Creation"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "Image_creationId_idx" ON "Image"("creationId");

-- CreateIndex
CREATE INDEX "Image_ownerUserId_idx" ON "Image"("ownerUserId");

-- CreateIndex
CREATE INDEX "Image_draftSessionId_idx" ON "Image"("draftSessionId");

-- CreateIndex
CREATE INDEX "Image_deletedAt_idx" ON "Image"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Purchase_rcTransactionId_key" ON "Purchase"("rcTransactionId");

-- CreateIndex
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");

-- CreateIndex
CREATE INDEX "Purchase_creationId_idx" ON "Purchase"("creationId");

-- CreateIndex
CREATE INDEX "RsvpResponse_creationId_createdAt_idx" ON "RsvpResponse"("creationId", "createdAt");

-- AddForeignKey
ALTER TABLE "RefreshToken" ADD CONSTRAINT "RefreshToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DraftSession" ADD CONSTRAINT "DraftSession_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Creation" ADD CONSTRAINT "Creation_draftSessionId_fkey" FOREIGN KEY ("draftSessionId") REFERENCES "DraftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_draftSessionId_fkey" FOREIGN KEY ("draftSessionId") REFERENCES "DraftSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RsvpResponse" ADD CONSTRAINT "RsvpResponse_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViewDaily" ADD CONSTRAINT "ViewDaily_creationId_fkey" FOREIGN KEY ("creationId") REFERENCES "Creation"("id") ON DELETE CASCADE ON UPDATE CASCADE;


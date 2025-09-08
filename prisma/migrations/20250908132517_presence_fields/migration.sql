/*
  Warnings:

  - You are about to drop the column `createdAt` on the `Vote` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[participantId, roundId]` on the table `Vote` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Participant_roomId_idx";

-- DropIndex
DROP INDEX "Participant_roomId_userId_key";

-- DropIndex
DROP INDEX "Vote_roundId_participantId_key";

-- AlterTable
ALTER TABLE "Participant" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Vote" DROP COLUMN "createdAt";

-- CreateIndex
CREATE INDEX "Participant_roomId_userId_idx" ON "Participant"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_participantId_roundId_key" ON "Vote"("participantId", "roundId");

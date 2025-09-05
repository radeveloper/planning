/*
  Warnings:

  - You are about to drop the column `ownerParticipantId` on the `Room` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[roundId,participantId]` on the table `Vote` will be added. If there are existing duplicate values, this will fail.
  - Made the column `settings` on table `Room` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Round" DROP CONSTRAINT "Round_roomId_fkey";

-- DropForeignKey
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_participantId_fkey";

-- DropForeignKey
ALTER TABLE "Vote" DROP CONSTRAINT "Vote_roundId_fkey";

-- AlterTable
ALTER TABLE "Room" DROP COLUMN "ownerParticipantId",
ALTER COLUMN "settings" SET NOT NULL,
ALTER COLUMN "settings" SET DEFAULT '{}';

-- CreateIndex
CREATE UNIQUE INDEX "Vote_roundId_participantId_key" ON "Vote"("roundId", "participantId");

-- AddForeignKey
ALTER TABLE "Round" ADD CONSTRAINT "Round_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "Round"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

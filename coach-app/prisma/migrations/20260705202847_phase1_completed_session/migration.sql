-- CreateEnum
CREATE TYPE "Sport" AS ENUM ('BIKE', 'RUN', 'SWIM', 'OTHER');

-- CreateTable
CREATE TABLE "CompletedSession" (
    "id" TEXT NOT NULL,
    "sport" "Sport" NOT NULL,
    "startTime" TIMESTAMP(3) NOT NULL,
    "elapsedSec" DOUBLE PRECISION NOT NULL,
    "movingSec" DOUBLE PRECISION,
    "distanceM" DOUBLE PRECISION,
    "avgPower" DOUBLE PRECISION,
    "maxPower" DOUBLE PRECISION,
    "avgHr" DOUBLE PRECISION,
    "maxHr" DOUBLE PRECISION,
    "avgCadence" DOUBLE PRECISION,
    "avgSpeedMps" DOUBLE PRECISION,
    "elevationGainM" DOUBLE PRECISION,
    "calories" DOUBLE PRECISION,
    "load" DOUBLE PRECISION,
    "fileName" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "rawSession" JSONB NOT NULL,
    "records" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompletedSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CompletedSession_fileSha256_key" ON "CompletedSession"("fileSha256");

-- CreateIndex
CREATE INDEX "CompletedSession_startTime_idx" ON "CompletedSession"("startTime");

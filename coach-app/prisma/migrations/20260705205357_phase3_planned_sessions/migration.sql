-- CreateEnum
CREATE TYPE "Slot" AS ENUM ('LUNCH', 'EVENING', 'MORNING');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('PLANNED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- CreateTable
CREATE TABLE "PlannedSession" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "slot" "Slot" NOT NULL,
    "sport" "Sport" NOT NULL,
    "title" TEXT NOT NULL,
    "intent" TEXT,
    "structure" JSONB,
    "durationMin" INTEGER NOT NULL,
    "estimatedLoad" DOUBLE PRECISION NOT NULL,
    "stopRule" TEXT NOT NULL,
    "isQuality" BOOLEAN NOT NULL DEFAULT false,
    "phase" TEXT NOT NULL,
    "status" "PlanStatus" NOT NULL DEFAULT 'PLANNED',
    "completedSessionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlannedSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppState" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "mode" TEXT NOT NULL DEFAULT 'RETURN',
    "runningCleared" BOOLEAN NOT NULL DEFAULT false,
    "swimPullOnly" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "AppState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlannedSession_completedSessionId_key" ON "PlannedSession"("completedSessionId");

-- CreateIndex
CREATE INDEX "PlannedSession_date_idx" ON "PlannedSession"("date");

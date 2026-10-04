CREATE TYPE "AgentAvailability" AS ENUM ('AVAILABLE', 'AWAY', 'UNAVAILABLE');

ALTER TABLE "users"
ADD COLUMN "availability" "AgentAvailability" NOT NULL DEFAULT 'AVAILABLE',
ADD COLUMN "avatarData" TEXT;

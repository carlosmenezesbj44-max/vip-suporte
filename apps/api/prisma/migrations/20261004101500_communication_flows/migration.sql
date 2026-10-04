ALTER TABLE "system_settings"
ADD COLUMN "communicationFlows" JSONB NOT NULL DEFAULT '[]';

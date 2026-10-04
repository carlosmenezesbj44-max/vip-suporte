ALTER TABLE "users" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "SupportChannelType" AS ENUM ('WHATSAPP', 'PHONE', 'EMAIL', 'OTHER');

CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "companyName" TEXT NOT NULL DEFAULT 'Canal Direto',
    "supportEmail" TEXT NOT NULL DEFAULT '',
    "supportPhone" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'America/Recife',
    "passwordMinLength" INTEGER NOT NULL DEFAULT 8,
    "sessionDurationDays" INTEGER NOT NULL DEFAULT 7,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "support_channels" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "SupportChannelType" NOT NULL,
    "address" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "support_channels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ixc_configuration" (
    "id" TEXT NOT NULL DEFAULT 'primary',
    "baseUrl" TEXT NOT NULL,
    "encryptedCredential" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ixc_configuration_pkey" PRIMARY KEY ("id")
);

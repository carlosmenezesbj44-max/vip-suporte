CREATE TABLE "ticket_attachments" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_attachments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ticket_attachments_storageName_key" ON "ticket_attachments"("storageName");
CREATE INDEX "ticket_attachments_messageId_idx" ON "ticket_attachments"("messageId");

ALTER TABLE "ticket_attachments"
ADD CONSTRAINT "ticket_attachments_messageId_fkey"
FOREIGN KEY ("messageId") REFERENCES "ticket_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

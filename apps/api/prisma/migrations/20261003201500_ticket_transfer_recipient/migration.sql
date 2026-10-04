ALTER TABLE "ticket_transfers"
ADD COLUMN "transferredToId" TEXT;

ALTER TABLE "ticket_transfers"
ADD CONSTRAINT "ticket_transfers_transferredToId_fkey"
FOREIGN KEY ("transferredToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

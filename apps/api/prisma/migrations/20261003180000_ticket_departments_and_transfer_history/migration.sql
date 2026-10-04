CREATE TYPE "TicketDepartment" AS ENUM ('COMMERCIAL', 'FINANCE', 'SUPPORT_N1', 'SUPPORT_N2', 'FIELD');

ALTER TABLE "tickets"
ADD COLUMN "department" "TicketDepartment" NOT NULL DEFAULT 'COMMERCIAL';

CREATE TABLE "ticket_transfers" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "fromDepartment" "TicketDepartment" NOT NULL,
    "toDepartment" "TicketDepartment" NOT NULL,
    "transferredById" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ticket_transfers_ticketId_createdAt_idx"
ON "ticket_transfers"("ticketId", "createdAt");

ALTER TABLE "ticket_transfers"
ADD CONSTRAINT "ticket_transfers_ticketId_fkey"
FOREIGN KEY ("ticketId") REFERENCES "tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ticket_transfers"
ADD CONSTRAINT "ticket_transfers_transferredById_fkey"
FOREIGN KEY ("transferredById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

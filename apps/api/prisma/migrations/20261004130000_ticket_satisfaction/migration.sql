ALTER TABLE "tickets"
ADD COLUMN "satisfactionRating" INTEGER,
ADD COLUMN "satisfactionComment" TEXT,
ADD COLUMN "satisfactionSubmittedAt" TIMESTAMP(3);

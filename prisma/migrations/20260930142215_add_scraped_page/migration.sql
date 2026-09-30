-- CreateTable
CREATE TABLE "ScrapedPage" (
    "url" TEXT NOT NULL,
    "lastFetchedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapedPage_pkey" PRIMARY KEY ("url")
);

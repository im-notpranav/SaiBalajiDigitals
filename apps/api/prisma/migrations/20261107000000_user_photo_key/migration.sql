-- Profile pictures are uploaded now, not linked: where the file lives in object storage.
ALTER TABLE "User" ADD COLUMN "photo_key" TEXT;

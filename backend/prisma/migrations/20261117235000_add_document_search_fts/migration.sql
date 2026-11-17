-- SQLite FTS5 virtual table for fast full-text lookup on unencrypted document metadata (title, merchantName).
CREATE VIRTUAL TABLE IF NOT EXISTS "DocumentSearchFts" USING fts5(
  documentId UNINDEXED,
  title,
  merchantName
);

INSERT INTO "DocumentSearchFts"(documentId, title, merchantName)
SELECT id, COALESCE(title, ''), COALESCE(merchantName, '') FROM "Document";

CREATE TRIGGER IF NOT EXISTS "document_fts_insert" AFTER INSERT ON "Document" BEGIN
  INSERT INTO "DocumentSearchFts"(documentId, title, merchantName)
  VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.merchantName, ''));
END;

CREATE TRIGGER IF NOT EXISTS "document_fts_update" AFTER UPDATE OF title, merchantName ON "Document" BEGIN
  DELETE FROM "DocumentSearchFts" WHERE documentId = old.id;
  INSERT INTO "DocumentSearchFts"(documentId, title, merchantName)
  VALUES (new.id, COALESCE(new.title, ''), COALESCE(new.merchantName, ''));
END;

CREATE TRIGGER IF NOT EXISTS "document_fts_delete" AFTER DELETE ON "Document" BEGIN
  DELETE FROM "DocumentSearchFts" WHERE documentId = old.id;
END;

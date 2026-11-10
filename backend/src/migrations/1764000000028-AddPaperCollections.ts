import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Personal paper collections (#188). A collection belongs to one reader and holds library entries, so it can
 * only ever hold papers that reader keeps: taking a paper out of the library, or deleting the reader, takes it
 * out of their collections too. Deleting a collection removes only its membership rows, never an entry, a paper
 * or a PDF. The tables are read and written with SQL, so there is no entity for them.
 */
export class AddPaperCollections1764000000028 implements MigrationInterface {
  name = 'AddPaperCollections1764000000028';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_collection" (
        "id" uuid NOT NULL DEFAULT uuidv7(),
        "userId" integer NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
        "name" character varying(80) NOT NULL,
        "createdAt" timestamp NOT NULL DEFAULT now(),
        "updatedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_collection" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_paper_collection_name" CHECK (length(btrim("name")) > 0)
      )
    `);
    // One name per reader, whatever the case: "Thesis" and "thesis" are the same collection.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_paper_collection_user_name" ON "paper_collection" ("userId", lower("name"))`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "paper_collection_item" (
        "collectionId" uuid NOT NULL REFERENCES "paper_collection"("id") ON DELETE CASCADE,
        "entryId" integer NOT NULL REFERENCES "paper_library_entry"("id") ON DELETE CASCADE,
        "addedAt" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_paper_collection_item" PRIMARY KEY ("collectionId", "entryId")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_paper_collection_item_entry" ON "paper_collection_item" ("entryId")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_collection_item"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "paper_collection"`);
  }
}

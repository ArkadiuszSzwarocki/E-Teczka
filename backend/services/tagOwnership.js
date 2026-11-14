"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareTags = prepareTags;
exports.tagIds = tagIds;
function prepareTags(prisma) {
    return __awaiter(this, void 0, void 0, function* () {
        yield prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanTagOwner (ownerId INTEGER NOT NULL, tagId INTEGER NOT NULL, PRIMARY KEY (ownerId, tagId), FOREIGN KEY(tagId) REFERENCES Tag(id) ON DELETE CASCADE)');
        yield prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS PlanMeta (key TEXT PRIMARY KEY)');
        yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            const marked = yield tx.$queryRaw `SELECT key FROM PlanMeta WHERE key = ${'tag-ownership-v1'}`;
            if (marked.length)
                return;
            yield tx.$executeRawUnsafe('INSERT OR IGNORE INTO PlanTagOwner(ownerId, tagId) SELECT DISTINCT f.ownerId, dt.tagId FROM DocumentTag dt JOIN Document d ON d.id=dt.documentId JOIN Folder f ON f.id=d.folderId');
            yield tx.$executeRawUnsafe('INSERT OR IGNORE INTO PlanTagOwner(ownerId, tagId) SELECT 1, t.id FROM Tag t WHERE NOT EXISTS (SELECT 1 FROM PlanTagOwner o WHERE o.tagId=t.id)');
            yield tx.$executeRaw `INSERT OR IGNORE INTO PlanMeta(key) VALUES (${'tag-ownership-v1'})`;
        }));
    });
}
function tagIds(tx, ownerId) {
    return __awaiter(this, void 0, void 0, function* () {
        const rows = yield tx.$queryRaw `SELECT tagId FROM PlanTagOwner WHERE ownerId = ${ownerId}`;
        return rows.map(row => Number(row.tagId));
    });
}

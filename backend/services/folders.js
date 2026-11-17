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
exports.collectFolderBranch = collectFolderBranch;
exports.isDocumentFolder = isDocumentFolder;
function collectFolderBranch(prisma, folderId, ownerId) {
    return __awaiter(this, void 0, void 0, function* () {
        const ids = [folderId];
        const children = yield prisma.folder.findMany({ where: Object.assign({ parentId: folderId }, (ownerId === undefined ? {} : { ownerId })), select: { id: true } });
        for (const child of children)
            ids.push(...yield collectFolderBranch(prisma, child.id, ownerId));
        return ids;
    });
}
/** Documents can be stored in both root and nested folders owned by the user. */
function isDocumentFolder(prisma, folderId) {
    return __awaiter(this, void 0, void 0, function* () {
        const id = Number(folderId);
        if (!Number.isInteger(id) || id < 1)
            return false;
        const folder = yield prisma.folder.findUnique({ where: { id }, select: { id: true } });
        return Boolean(folder);
    });
}

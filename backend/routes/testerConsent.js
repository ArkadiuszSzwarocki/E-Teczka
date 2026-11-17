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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTesterConsentRouter = createTesterConsentRouter;
const express_1 = __importDefault(require("express"));
const testerConsent_1 = require("../services/testerConsent");
/** Endpoints for reading and recording public-test privacy & local storage consent. */
function createTesterConsentRouter(prisma) {
    const router = express_1.default.Router();
    const userId = (res) => Number(res.locals.userId || 1);
    router.get('/', (_req, res) => __awaiter(this, void 0, void 0, function* () {
        try {
            res.json(yield (0, testerConsent_1.getTesterConsent)(prisma, userId(res)));
        }
        catch (_a) {
            res.status(500).json({ error: 'Nie udało się sprawdzić zgody testera.' });
        }
    }));
    router.post('/', (req, res) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const accepted = ((_a = req.body) === null || _a === void 0 ? void 0 : _a.accepted) === true;
            const modeRaw = (_b = req.body) === null || _b === void 0 ? void 0 : _b.storageMode;
            const storageMode = modeRaw === 'qnap_server'
                ? 'qnap_server'
                : modeRaw === 'local_browser'
                    ? 'local_browser'
                    : 'local_disk';
            const record = yield (0, testerConsent_1.saveTesterConsent)(prisma, userId(res), { accepted, storageMode });
            res.json({ consent: record });
        }
        catch (_c) {
            res.status(500).json({ error: 'Nie udało się zapisać zgody testera.' });
        }
    }));
    return router;
}

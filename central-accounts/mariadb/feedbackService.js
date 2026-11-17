'use strict';

const { first, execute } = require('./dbHelpers');

const ALLOWED_CATEGORIES = new Set(['bug', 'feedback', 'backup', 'other']);
const ALLOWED_STATUSES = new Set(['new', 'in_progress', 'resolved', 'closed']);
const SCREENSHOT_PATTERN = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/;
const MAX_SCREENSHOT_BASE64_LENGTH = 2_800_000;

async function ensureFeedbackSchema(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS user_feedback (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    account_id BIGINT UNSIGNED NULL,
    contact_email VARCHAR(254) NULL,
    category VARCHAR(32) NOT NULL,
    title VARCHAR(160) NOT NULL,
    description TEXT NOT NULL,
    app_version VARCHAR(40) NULL,
    platform VARCHAR(40) NULL,
    active_view VARCHAR(60) NULL,
    screenshot_mime VARCHAR(32) NULL,
    screenshot_data LONGTEXT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'new',
    created_at BIGINT NOT NULL,
    INDEX (status, created_at),
    FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
}

function parseScreenshot(raw) {
  if (!raw) return { mime: null, data: null };
  if (typeof raw !== 'string') throw new Error('INVALID_SCREENSHOT');
  const trimmed = raw.trim();
  if (!trimmed) return { mime: null, data: null };
  if (trimmed.length > MAX_SCREENSHOT_BASE64_LENGTH) throw new Error('SCREENSHOT_TOO_LARGE');
  const match = trimmed.match(SCREENSHOT_PATTERN);
  if (!match) throw new Error('INVALID_SCREENSHOT');
  return { mime: match[1], data: trimmed };
}

function cleanText(value, min, max, errorCode) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (text.length < min || text.length > max) throw new Error(errorCode);
  return text;
}

function optionalText(value, max) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function createFeedbackService({ pool, getSession, now = Date.now }) {
  async function create(bearerToken, input) {
    const category = typeof input?.category === 'string' ? input.category.trim() : 'bug';
    if (!ALLOWED_CATEGORIES.has(category)) throw new Error('INVALID_CATEGORY');
    const title = cleanText(input?.title, 3, 160, 'INVALID_TITLE');
    const description = cleanText(input?.description, 5, 5000, 'INVALID_DESCRIPTION');
    const contactEmail = optionalText(input?.contactEmail, 254);
    if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new Error('INVALID_EMAIL');
    const { mime, data } = parseScreenshot(input?.screenshotDataUrl);
    const session = bearerToken && getSession ? await getSession(bearerToken).catch(() => null) : null;
    const createdAt = now();
    const [result] = await pool.query(
      `INSERT INTO user_feedback (account_id, contact_email, category, title, description, app_version, platform, active_view, screenshot_mime, screenshot_data, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?)`,
      [
        session?.id || null,
        contactEmail,
        category,
        title,
        description,
        optionalText(input?.appVersion, 40),
        optionalText(input?.platform, 40),
        optionalText(input?.activeView, 60),
        mime,
        data,
        createdAt,
      ],
    );
    return { id: Number(result.insertId), status: 'new', createdAt };
  }

  async function list(statusFilter, limit = 50) {
    const safeLimit = Math.min(200, Math.max(1, Number(limit) || 50));
    const hasFilter = typeof statusFilter === 'string' && ALLOWED_STATUSES.has(statusFilter);
    const where = hasFilter ? 'WHERE f.status = ?' : '';
    const params = hasFilter ? [statusFilter, safeLimit] : [safeLimit];
    const rows = await execute(
      pool,
      `SELECT f.id, f.account_id AS accountId, a.email AS accountEmail, f.contact_email AS contactEmail,
              f.category, f.title, f.description, f.app_version AS appVersion, f.platform,
              f.active_view AS activeView, f.screenshot_data AS screenshotDataUrl, f.status, f.created_at AS createdAt
       FROM user_feedback f
       LEFT JOIN accounts a ON a.id = f.account_id
       ${where}
       ORDER BY f.created_at DESC
       LIMIT ?`,
      params,
    );
    return rows.map(row => ({ ...row, id: Number(row.id), createdAt: Number(row.createdAt) }));
  }

  async function updateStatus(id, status) {
    const numericId = Number(id);
    if (!Number.isSafeInteger(numericId) || numericId < 1) throw new Error('INVALID_ID');
    if (!ALLOWED_STATUSES.has(status)) throw new Error('INVALID_STATUS');
    const existing = await first(pool, 'SELECT id FROM user_feedback WHERE id = ?', [numericId]);
    if (!existing) throw new Error('NOT_FOUND');
    await execute(pool, 'UPDATE user_feedback SET status = ? WHERE id = ?', [status, numericId]);
    return { id: numericId, status };
  }

  return { create, list, updateStatus };
}

module.exports = { ensureFeedbackSchema, createFeedbackService, ALLOWED_CATEGORIES, ALLOWED_STATUSES };

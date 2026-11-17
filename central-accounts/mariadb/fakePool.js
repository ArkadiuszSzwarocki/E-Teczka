'use strict';

function createFakeMariaPool() {
  let nextId = 1;
  const tables = {
    accounts: [],
    identities: [],
    verifications: [],
    sessions: [],
    password_resets: [],
    google_challenges: [],
    sign_in_handoffs: [],
    auth_rate_limits: []
    ,account_plans: [], account_devices: []
  };

  async function execute(sql, params = []) {
    const q = sql.replace(/\s+/g, ' ').trim();
    if(q.startsWith('INSERT IGNORE INTO account_plans')){if(!tables.account_plans.some(a=>a.account_id===params[0]))tables.account_plans.push({account_id:params[0],plan:'free',status:'active',valid_until:null,updated_at:params[1]});return [{affectedRows:1}];}
    if(q.startsWith('SELECT id FROM accounts WHERE id = ?')){const row=tables.accounts.find(a=>a.id===params[0]);return [row?[{id:row.id}]:[]];}
    if(q.startsWith('SELECT * FROM account_plans WHERE account_id = ?'))return [tables.account_plans.filter(a=>a.account_id===params[0]).map(a=>({...a}))];
    if(q.startsWith('SELECT * FROM account_devices WHERE account_id = ? AND device_id = ?'))return [tables.account_devices.filter(d=>d.account_id===params[0]&&d.device_id===params[1]).map(d=>({...d}))];
    if(q.startsWith('SELECT device_id FROM account_devices WHERE account_id = ? AND kind = ?'))return [tables.account_devices.filter(d=>d.account_id===params[0]&&d.kind===params[1]).sort((a,b)=>a.created_at-b.created_at||a.device_id.localeCompare(b.device_id)).map(d=>({device_id:d.device_id}))];
    if(q.startsWith('INSERT INTO account_devices')){tables.account_devices.push({account_id:params[0],device_id:params[1],kind:params[2],name:params[3],credential_hash:params[4],created_at:params[5],last_seen:params[6]});return [{affectedRows:1}];}
    if(q.startsWith('UPDATE account_devices SET last_seen')){const row=tables.account_devices.find(d=>d.account_id===params[1]&&d.device_id===params[2]);if(row)row.last_seen=params[0];return [{affectedRows:row?1:0}];}
    if(q.startsWith('SELECT d.*, a.public_id FROM account_devices')){const d=tables.account_devices.find(d=>d.credential_hash===params[0]);const a=d&&tables.accounts.find(a=>a.id===d.account_id);return [a?[{...d,public_id:a.public_id}]:[]];}
    if(q.startsWith('SELECT device_id,kind,name,created_at,last_seen FROM account_devices'))return [tables.account_devices.filter(d=>d.account_id===params[0]).map(({device_id,kind,name,created_at,last_seen})=>({device_id,kind,name,created_at,last_seen}))];
    if(q.startsWith('DELETE FROM account_devices WHERE account_id = ? AND device_id = ?')){const before=tables.account_devices.length;tables.account_devices=tables.account_devices.filter(d=>d.account_id!==params[0]||d.device_id!==params[1]);return [{affectedRows:before-tables.account_devices.length}];}

    if (q.startsWith('SELECT id, verified FROM accounts WHERE email = ?')) {
      const row = tables.accounts.find(a => a.email === params[0]);
      return [row ? [{ id: row.id, verified: row.verified }] : []];
    }
    if (q.startsWith('SELECT id FROM accounts WHERE email = ? AND verified = 0')) {
      const row = tables.accounts.find(a => a.email === params[0] && !a.verified);
      return [row ? [{ id: row.id }] : []];
    }
    if (q.startsWith('SELECT id FROM accounts WHERE email = ? AND verified = 1 AND password_hash IS NOT NULL')) {
      const row = tables.accounts.find(a => a.email === params[0] && a.verified === 1 && a.password_hash !== null);
      return [row ? [{ id: row.id }] : []];
    }
    if (q.startsWith('SELECT id FROM accounts WHERE email = ? AND verified = 1')) {
      const row = tables.accounts.find(a => a.email === params[0] && a.verified === 1);
      return [row ? [{ id: row.id }] : []];
    }
    if (q.startsWith('SELECT id FROM accounts WHERE email = ?')) {
      const row = tables.accounts.find(a => a.email === params[0]);
      return [row ? [{ id: row.id }] : []];
    }
    if (q.startsWith('SELECT * FROM accounts WHERE email = ?')) {
      const row = tables.accounts.find(a => a.email === params[0]);
      return [row ? [{ ...row }] : []];
    }
    if (q.startsWith('SELECT * FROM accounts WHERE id = ?')) {
      const row = tables.accounts.find(a => a.id === params[0]);
      return [row ? [{ ...row }] : []];
    }
    if (q.startsWith('INSERT INTO accounts (public_id,email,password_hash,created_at)')) {
      if (tables.accounts.some(a => a.email === params[1])) {
        const err = new Error('Duplicate'); err.code = 'ER_DUP_ENTRY'; throw err;
      }
      const id = nextId++;
      tables.accounts.push({ id, public_id: params[0], email: params[1], name: null, password_hash: params[2], verified: 0, created_at: params[3] });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO accounts (public_id, email, name, verified, created_at)')) {
      if (tables.accounts.some(a => a.email === params[1])) {
        const err = new Error('Duplicate'); err.code = 'ER_DUP_ENTRY'; throw err;
      }
      const id = nextId++;
      tables.accounts.push({ id, public_id: params[0], email: params[1], name: params[2], password_hash: null, verified: 1, created_at: params[3] });
      return [{ insertId: id, affectedRows: 1 }];
    }
    if (q.startsWith('UPDATE accounts SET verified = 1 WHERE id = ?')) {
      const row = tables.accounts.find(row => row.id === params[0]);
      if (row) row.verified = 1;
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.startsWith('UPDATE accounts SET verified = 1, password_hash = NULL WHERE id = ?')) {
      const row = tables.accounts.find(row => row.id === params[0]);
      if (row) { row.verified = 1; row.password_hash = null; }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.startsWith('UPDATE accounts SET verified = 1, password_hash = ? WHERE id = ?')) {
      const row = tables.accounts.find(a => a.id === params[1]);
      if (row) { row.verified = 1; row.password_hash = params[0]; }
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.startsWith('UPDATE accounts SET password_hash = ? WHERE id = ? AND verified = 1')) {
      const row = tables.accounts.find(a => a.id === params[1] && a.verified === 1);
      if (row) row.password_hash = params[0];
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.startsWith('INSERT INTO verifications')) {
      tables.verifications.push({ token_hash: params[0], account_id: params[1], expires_at: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT account_id FROM verifications WHERE token_hash = ? AND expires_at > ?')) {
      const row = tables.verifications.find(v => v.token_hash === params[0] && v.expires_at > params[1]);
      return [row ? [{ account_id: row.account_id }] : []];
    }
    if (q.startsWith('DELETE FROM verifications WHERE account_id = ?')) {
      const before = tables.verifications.length;
      tables.verifications = tables.verifications.filter(v => v.account_id !== params[0]);
      return [{ affectedRows: before - tables.verifications.length }];
    }
    if (q.startsWith('DELETE FROM verifications WHERE token_hash = ?')) {
      const before = tables.verifications.length;
      tables.verifications = tables.verifications.filter(v => v.token_hash !== params[0]);
      return [{ affectedRows: before - tables.verifications.length }];
    }
    if (q.startsWith('INSERT INTO password_resets')) {
      tables.password_resets.push({ token_hash: params[0], account_id: params[1], expires_at: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT account_id FROM password_resets WHERE token_hash = ? AND expires_at > ?')) {
      const row = tables.password_resets.find(v => v.token_hash === params[0] && v.expires_at > params[1]);
      return [row ? [{ account_id: row.account_id }] : []];
    }
    if (q.startsWith('DELETE FROM password_resets WHERE account_id = ?')) {
      const before = tables.password_resets.length;
      tables.password_resets = tables.password_resets.filter(v => v.account_id !== params[0]);
      return [{ affectedRows: before - tables.password_resets.length }];
    }
    if (q.startsWith('DELETE FROM password_resets WHERE token_hash = ?')) {
      const before = tables.password_resets.length;
      tables.password_resets = tables.password_resets.filter(v => v.token_hash !== params[0]);
      return [{ affectedRows: before - tables.password_resets.length }];
    }
    if (q.startsWith('INSERT INTO sessions')) {
      tables.sessions.push({ token_hash: params[0], account_id: params[1], expires_at: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT a.id AS internal_id, a.public_id AS id, a.email, a.name FROM sessions s JOIN accounts a')) {
      const s = tables.sessions.find(x => x.token_hash === params[0] && x.expires_at > params[1]);
      const a = s && tables.accounts.find(y => y.id === s.account_id);
      return [a ? [{ internal_id: a.id, id: a.public_id, email: a.email, name: a.name }] : []];
    }
    if (q.startsWith('SELECT a.* FROM sessions s JOIN accounts a')) {
      const s = tables.sessions.find(x => x.token_hash === params[0] && x.expires_at > params[1]);
      const a = s && tables.accounts.find(y => y.id === s.account_id);
      return [a ? [{ ...a }] : []];
    }
    if (q.startsWith('DELETE FROM sessions WHERE token_hash = ?')) {
      const before = tables.sessions.length;
      tables.sessions = tables.sessions.filter(s => s.token_hash !== params[0]);
      return [{ affectedRows: before - tables.sessions.length }];
    }
    if (q.startsWith('DELETE FROM sessions WHERE account_id = ?')) {
      const before = tables.sessions.length;
      tables.sessions = tables.sessions.filter(s => s.account_id !== params[0]);
      return [{ affectedRows: before - tables.sessions.length }];
    }
    if (q.startsWith('INSERT INTO google_challenges')) {
      tables.google_challenges.push({ token_hash: params[0], expires_at: params[1] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('DELETE FROM google_challenges WHERE token_hash = ? AND expires_at > ?')) {
      const before = tables.google_challenges.length;
      tables.google_challenges = tables.google_challenges.filter(c => !(c.token_hash === params[0] && c.expires_at > params[1]));
      return [{ affectedRows: before - tables.google_challenges.length }];
    }
    if (q.startsWith('SELECT a.* FROM accounts a JOIN identities i')) {
      const ident = tables.identities.find(i => i.provider === params[0] && i.subject === params[1]);
      const a = ident && tables.accounts.find(y => y.id === ident.account_id);
      return [a ? [{ ...a }] : []];
    }
    if (q.startsWith('SELECT account_id FROM identities WHERE provider = ? AND subject = ?')) {
      const ident = tables.identities.find(i => i.provider === params[0] && i.subject === params[1]);
      return [ident ? [{ account_id: ident.account_id }] : []];
    }
    if (q.startsWith('INSERT INTO identities')) {
      tables.identities.push({ provider: params[0], subject: params[1], account_id: params[2] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('INSERT INTO sign_in_handoffs')) {
      tables.sign_in_handoffs.push({ id_hash: params[0], challenge: params[1], device_name: params[2], display_code: params[3], approved_session_hash: null, expires_at: params[4] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT device_name AS deviceName, display_code AS displayCode FROM sign_in_handoffs')) {
      const row = tables.sign_in_handoffs.find(h => h.id_hash === params[0] && h.expires_at > params[1] && h.approved_session_hash === null);
      return [row ? [{ deviceName: row.device_name, displayCode: row.display_code }] : []];
    }
    if (q.startsWith('UPDATE sign_in_handoffs SET approved_session_hash = ?')) {
      const row = tables.sign_in_handoffs.find(h => h.id_hash === params[1] && h.expires_at > params[2] && h.approved_session_hash === null);
      if (row) row.approved_session_hash = params[0];
      return [{ affectedRows: row ? 1 : 0 }];
    }
    if (q.startsWith('SELECT challenge, approved_session_hash FROM sign_in_handoffs')) {
      const row = tables.sign_in_handoffs.find(h => h.id_hash === params[0] && h.expires_at > params[1]);
      return [row ? [{ challenge: row.challenge, approved_session_hash: row.approved_session_hash }] : []];
    }
    if (q.startsWith('DELETE FROM sign_in_handoffs WHERE id_hash = ?')) {
      const before = tables.sign_in_handoffs.length;
      tables.sign_in_handoffs = tables.sign_in_handoffs.filter(h => h.id_hash !== params[0]);
      return [{ affectedRows: before - tables.sign_in_handoffs.length }];
    }
    if (q.startsWith('DELETE FROM auth_rate_limits WHERE `key` = ? AND expires_at <= ?')) {
      const before = tables.auth_rate_limits.length;
      tables.auth_rate_limits = tables.auth_rate_limits.filter(r => !(r.key === params[0] && r.expires_at <= params[1]));
      return [{ affectedRows: before - tables.auth_rate_limits.length }];
    }
    if (q.startsWith('INSERT INTO auth_rate_limits')) {
      const existing = tables.auth_rate_limits.find(r => r.key === params[0]);
      if (existing) existing.count += 1;
      else tables.auth_rate_limits.push({ key: params[0], count: 1, expires_at: params[1] });
      return [{ affectedRows: 1 }];
    }
    if (q.startsWith('SELECT `count`, expires_at FROM auth_rate_limits WHERE `key` = ?')) {
      const existing = tables.auth_rate_limits.find(r => r.key === params[0]);
      return [existing ? [{ count: existing.count, expires_at: existing.expires_at }] : []];
    }
    const cleanMatch = q.match(/^DELETE FROM ([a-z_]+) WHERE expires_at <= \?$/);
    if (cleanMatch && tables[cleanMatch[1]]) {
      const t = cleanMatch[1];
      const before = tables[t].length;
      tables[t] = tables[t].filter(r => r.expires_at > params[0]);
      return [{ affectedRows: before - tables[t].length }];
    }
    throw new Error(`Unsupported fake SQL: ${q}`);
  }

  return {
    tables,
    execute,
    async getConnection() {
      return {
        execute,
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {}
      };
    }
  };
}

module.exports = { createFakeMariaPool };

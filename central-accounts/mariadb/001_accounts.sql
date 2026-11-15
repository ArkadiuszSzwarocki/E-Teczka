-- Schemat usługi kont. Uruchamiać wyłącznie w dedykowanej bazie E-Teczka.
-- Hasła są zapisywane jako scrypt z osobną solą; tokeny wyłącznie jako SHA-256.
CREATE TABLE IF NOT EXISTS accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  public_id CHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE,
  email VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL UNIQUE,
  name VARCHAR(255) NULL,
  password_hash VARCHAR(161) CHARACTER SET ascii COLLATE ascii_bin NULL,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS identities (
  provider VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY(provider, subject),
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS verifications (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL, expires_at BIGINT NOT NULL,
  INDEX (account_id), INDEX (expires_at),
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL, expires_at BIGINT NOT NULL,
  INDEX (account_id), INDEX (expires_at),
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS password_resets (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  account_id BIGINT UNSIGNED NOT NULL, expires_at BIGINT NOT NULL,
  INDEX (account_id), INDEX (expires_at),
  FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS google_challenges (
  token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  expires_at BIGINT NOT NULL, INDEX (expires_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sign_in_handoffs (
  id_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  challenge CHAR(43) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  device_name VARCHAR(80) NOT NULL,
  display_code CHAR(6) CHARACTER SET ascii NOT NULL,
  approved_session_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  expires_at BIGINT NOT NULL, INDEX (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  `key` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
  `count` INT UNSIGNED NOT NULL, expires_at BIGINT NOT NULL, INDEX (expires_at)
) ENGINE=InnoDB;

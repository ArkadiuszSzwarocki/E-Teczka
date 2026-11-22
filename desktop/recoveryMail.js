const path = require('path');

function createRecoveryMailer(backendDirectory) {
  try {
    require(path.join(backendDirectory, 'node_modules', 'dotenv')).config({ path: path.join(backendDirectory, '.env'), quiet: true });
  } catch {
    // The desktop lock must remain usable when mail dependencies are unavailable.
  }
  const host = process.env.MOJATECZKA_SMTP_HOST;
  const user = process.env.MOJATECZKA_SMTP_USER;
  const password = process.env.MOJATECZKA_SMTP_PASSWORD;
  const from = process.env.MOJATECZKA_SMTP_FROM;
  if (!host || !user || !password || !from) return { configured: false, send: async () => { throw new Error('SMTP is not configured'); } };
  let nodemailer;
  try { nodemailer = require(path.join(backendDirectory, 'node_modules', 'nodemailer')); }
  catch { return { configured: false, send: async () => { throw new Error('Mail transport is unavailable'); } }; }
  const port = Number(process.env.MOJATECZKA_SMTP_PORT || 465);
  const transport = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass: password } });
  return {
    configured: true,
    send: async (to, code, purpose) => {
      await transport.sendMail({
        from, to,
        subject: purpose === 'reset' ? 'E-Teczka — kod resetowania blokady' : 'E-Teczka — potwierdzenie adresu odzyskiwania',
        text: `Kod E-Teczki: ${code}\n\nKod jest ważny 10 minut. Jeśli nie inicjowano tej operacji, zignoruj tę wiadomość.`,
      });
    },
  };
}

module.exports = { createRecoveryMailer };

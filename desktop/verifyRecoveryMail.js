const path = require('path');
const backend = path.join(__dirname, '..', 'backend');
require(path.join(backend, 'node_modules', 'dotenv')).config({ path: path.join(backend, '.env'), quiet: true });
const nodemailer = require(path.join(backend, 'node_modules', 'nodemailer'));
const port = Number(process.env.ETECZKA_SMTP_PORT || 465);
const transport = nodemailer.createTransport({
  host: process.env.ETECZKA_SMTP_HOST,
  port,
  secure: port === 465,
  auth: { user: process.env.ETECZKA_SMTP_USER, pass: process.env.ETECZKA_SMTP_PASSWORD },
});
transport.verify().then(() => {
  console.log('SMTP OK. Restart E-Teczka, then verify the recovery address with a code.');
}).catch(() => {
  console.error('SMTP login failed. Check the WP mail app password and mail program access.');
  process.exitCode = 1;
});

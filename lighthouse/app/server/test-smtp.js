/**
 * SMTP smoke test — reads server/.env, verifies STARTTLS + auth.
 * Usage: node test-smtp.js
 * Optional: node test-smtp.js --send you@nutanix.com  (sends a one-line test)
 */
require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const nodemailer = require('nodemailer');

const host = process.env.SMTP_HOST || 'secure-mailrelay.corp.nutanix.com';
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || require('./config/emailConfig.json').smtp?.from || user;

if (!user || !pass) {
  console.error('Email smoke test skipped: SMTP_USER and/or SMTP_PASS not set in server/.env');
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host,
  port,
  secure: false,
  requireTLS: true,
  auth: { user, pass },
  tls: { minVersion: 'TLSv1.2', rejectUnauthorized: false },
  connectionTimeout: 30000,
});

(async () => {
  console.log(`Connecting → ${host}:${port} as ${user} (from=${from})`);
  try {
    await transporter.verify();
    console.log('✓ SMTP verify OK (auth + STARTTLS)');
  } catch (err) {
    console.error('✗ SMTP verify failed:', err.message);
    process.exit(1);
  }

  const sendTo = process.argv[2] === '--send' ? process.argv[3] : null;
  if (!sendTo) {
    console.log('Done (auth only). To send a test: node test-smtp.js --send you@nutanix.com');
    process.exit(0);
  }

  try {
    const info = await transporter.sendMail({
      from,
      to: sendTo,
      subject: 'SMTP Test — delivery-ops',
      text: `Smoke test from ${user} at ${new Date().toISOString()}`,
    });
    console.log('✓ Test email sent:', info.messageId, 'accepted:', info.accepted);
  } catch (err) {
    console.error('✗ Send failed:', err.message);
    process.exit(1);
  }
})();

/**
 * email.js — Resend (primary) + nodemailer SMTP (fallback)
 *
 * Priority:
 *   1. RESEND_API_KEY set → use Resend API
 *   2. SMTP_HOST set      → use nodemailer SMTP
 *   3. Neither            → dev mode (links printed to console only)
 */
import "dotenv/config";
import dns from "dns";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import { APP_BASE_URL, FRONTEND_ORIGIN, ADMIN_SEED_EMAIL } from "./shared.js";

// ── Transport selection ───────────────────────────────────────────────────────
const USE_RESEND = !!process.env.RESEND_API_KEY;
const USE_SMTP   = !USE_RESEND && !!process.env.SMTP_HOST;

// ── Sender address ────────────────────────────────────────────────────────────
// RESEND_FROM is used when sending via Resend; SMTP_FROM when using SMTP.
// Both fall back to a derived address if not explicitly set.
export const MAIL_FROM =
  (USE_RESEND ? process.env.RESEND_FROM : undefined) ||
  process.env.SMTP_FROM ||
  (process.env.SMTP_USER
    ? `"HORIBA Astra Knowledge System" <${process.env.SMTP_USER}>`
    : '"HORIBA Astra Knowledge System" <do_not_reply@horiba.com>');

let resend = null;
let transporter = null;

if (USE_RESEND) {
  resend = new Resend(process.env.RESEND_API_KEY);
  console.log("Email: using Resend API");
} else if (USE_SMTP) {
  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = parseInt(process.env.SMTP_PORT || "587");
  const smtpSecure = process.env.SMTP_SECURE === "true";

  // For SSL (port 465) use the hostname directly so SNI works correctly.
  // For plain/STARTTLS, pre-resolve to IPv4 to handle internal servers that
  // don't respond on IPv6.
  let resolvedHost = smtpHost;
  if (!smtpSecure) {
    resolvedHost = await new Promise((resolve) =>
      dns.resolve4(smtpHost, (err, addrs) => {
        const ip = !err && addrs?.length ? addrs[0] : smtpHost;
        if (!err) console.log(`SMTP ${smtpHost} → ${ip} (IPv4)`);
        resolve(ip);
      })
    );
  }

  transporter = nodemailer.createTransport({
    host:              resolvedHost,
    port:              smtpPort,
    secure:            smtpSecure,
    connectionTimeout: 5_000,
    greetingTimeout:   5_000,
    socketTimeout:     5_000,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
    tls: { servername: smtpHost, rejectUnauthorized: false },
  });
  console.log("Email: using SMTP");
} else {
  console.log("Email: dev mode — links printed to console only");
}

// ── Core send helper ──────────────────────────────────────────────────────────
async function sendMail({ to, subject, html }) {
  if (USE_RESEND) {
    const { error } = await resend.emails.send({
      from:    MAIL_FROM,
      to:      [to],
      subject,
      html,
    });
    if (error) throw new Error(error.message);
  } else if (USE_SMTP) {
    await transporter.sendMail({ from: MAIL_FROM, to, subject, html });
  }
  // dev mode: no-op (caller already logged the link)
}

// ── Email templates ───────────────────────────────────────────────────────────
function verificationEmailHtml(name, verifyUrl) {
  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f5f7;font-family:Inter,system-ui,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#1677ff;padding:28px 36px;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">HORIBA</span>
          <span style="font-size:13px;color:rgba(255,255,255,0.75);margin-left:10px;">Astra Docs</span>
        </td></tr>
        <tr><td style="padding:36px 36px 24px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Verify your email</p>
          <p style="margin:0 0 24px;font-size:15px;color:#6b7280;">Hello${name ? " " + name : ""},</p>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
            Thanks for registering on Astra Docs.<br>
            Click the button below to confirm your email address. An administrator will then validate your access.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="background:#1677ff;border-radius:8px;">
              <a href="${verifyUrl}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Confirm my email</a>
            </td></tr>
          </table>
          <p style="margin:0 0 8px;font-size:13px;color:#9ca3af;">This link expires in <strong>30 minutes</strong>. If you did not create an account, you can safely ignore this email.</p>
          <p style="margin:16px 0 0;font-size:12px;color:#d1d5db;word-break:break-all;">Or copy this link: ${verifyUrl}</p>
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid #f3f5f7;font-size:12px;color:#9ca3af;">
          HORIBA FRANCE · AI LAB &nbsp;·&nbsp; Astra Docs &nbsp;·&nbsp; Do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function approvalEmailHtml(name) {
  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f5f7;font-family:Inter,system-ui,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#478cd0;padding:28px 36px;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">HORIBA</span>
          <span style="font-size:13px;color:rgba(255,255,255,0.75);margin-left:10px;">Astra Docs</span>
        </td></tr>
        <tr><td style="padding:36px 36px 24px;">
          <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Access granted</p>
          <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
            Hello${name ? " " + name : ""},<br><br>
            Your Astra Docs account has been <strong>approved</strong> by an administrator.<br>
            You can now sign in and access the documentation assistant.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="background:#478cd0;border-radius:8px;">
              <a href="${FRONTEND_ORIGIN}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Sign in to Astra Docs</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid #f3f5f7;font-size:12px;color:#9ca3af;">
          HORIBA FRANCE · AI LAB &nbsp;·&nbsp; Astra Docs &nbsp;·&nbsp; Do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function rejectionEmailHtml(name) {
  return `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f5f7;font-family:Inter,system-ui,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#478cd0;padding:28px 36px;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">HORIBA</span>
          <span style="font-size:13px;color:rgba(255,255,255,0.75);margin-left:10px;">Astra Docs</span>
        </td></tr>
        <tr><td style="padding:36px 36px 24px;">
          <p style="margin:0 0 16px;font-size:22px;font-weight:700;color:#111827;">Access request declined</p>
          <p style="margin:0 0 20px;font-size:15px;color:#374151;line-height:1.6;">
            Hello${name ? " " + name : ""},<br><br>
            Unfortunately your request to access Astra Docs has been <strong>declined</strong> by an administrator.<br>
            If you believe this is an error, please contact your administrator directly.
          </p>
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid #f3f5f7;font-size:12px;color:#9ca3af;">
          HORIBA FRANCE · AI LAB &nbsp;·&nbsp; Astra Docs &nbsp;·&nbsp; Do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ── Public API ────────────────────────────────────────────────────────────────
export async function sendApprovalEmail(email, name) {
  console.log("\n── Approval email ────────────────────────────────");
  console.log("To:", email);
  console.log("─────────────────────────────────────────────────\n");
  try {
    await sendMail({ to: email, subject: "Your Astra Docs access has been approved", html: approvalEmailHtml(name) });
    console.log("✓ Approval email sent to", email);
  } catch (err) {
    console.error("✗ Email send failed:", err.message);
  }
}

export async function sendRejectionEmail(email, name) {
  console.log("\n── Rejection email ───────────────────────────────");
  console.log("To:", email);
  console.log("─────────────────────────────────────────────────\n");
  try {
    await sendMail({ to: email, subject: "Your Astra Docs access request", html: rejectionEmailHtml(name) });
    console.log("✓ Rejection email sent to", email);
  } catch (err) {
    console.error("✗ Email send failed:", err.message);
  }
}

export async function sendAdminNewLdapUserEmail(userName, userEmail, adminEmails = []) {
  const html = `<!DOCTYPE html><html lang="en">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f3f5f7;font-family:Inter,system-ui,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f5f7;padding:40px 0;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr><td style="background:#1677ff;padding:28px 36px;">
          <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">HORIBA</span>
          <span style="font-size:13px;color:rgba(255,255,255,0.75);margin-left:10px;">Astra Docs</span>
        </td></tr>
        <tr><td style="padding:36px 36px 24px;">
          <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">New access request</p>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
            A HORIBA user has just authenticated and is requesting access to Astra Docs:<br><br>
            <strong>${userName || userEmail}</strong>${userName ? ` &lt;${userEmail}&gt;` : ""}
          </p>
          <p style="margin:0 0 24px;font-size:15px;color:#374151;line-height:1.6;">
            Please log in to approve or deny this request.
          </p>
          <table cellpadding="0" cellspacing="0" style="margin:0 0 28px;">
            <tr><td style="background:#1677ff;border-radius:8px;">
              <a href="${FRONTEND_ORIGIN}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">Open Astra Docs</a>
            </td></tr>
          </table>
        </td></tr>
        <tr><td style="padding:20px 36px;border-top:1px solid #f3f5f7;font-size:12px;color:#9ca3af;">
          HORIBA FRANCE · AI LAB &nbsp;·&nbsp; Astra Docs &nbsp;·&nbsp; Do not reply to this email.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  // Always include the seed admin; merge with any DB admins passed in
  const recipients = [...new Set([ADMIN_SEED_EMAIL, ...adminEmails])].filter(Boolean);

  console.log(`\n── Admin notification email ──────────────────────`);
  console.log(`New LDAP user pending approval: ${userName || ""} <${userEmail}>`);
  console.log(`Recipients: ${recipients.join(", ")}`);
  console.log(`─────────────────────────────────────────────────\n`);

  await Promise.allSettled(
    recipients.map(to =>
      sendMail({ to, subject: `New access request: ${userName || userEmail}`, html })
        .then(() => console.log("✓ Admin notification sent to", to))
        .catch(err => console.error(`✗ Admin notification to ${to} failed:`, err.message))
    )
  );
}

export async function sendVerificationEmail(email, name, token) {
  const verifyUrl = `${APP_BASE_URL}/api/auth/verify?token=${token}`;
  console.log("\n── Verification email ────────────────────────────");
  console.log("To:  ", email);
  console.log("Link:", verifyUrl);
  console.log("─────────────────────────────────────────────────\n");
  try {
    await sendMail({ to: email, subject: "Confirm your Astra Docs account", html: verificationEmailHtml(name, verifyUrl) });
    console.log("✓ Verification email sent to", email);
  } catch (err) {
    console.error("✗ Email send failed:", err.message);
  }
}

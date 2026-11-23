import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import env from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const templateDir = path.join(__dirname, '..', 'templates');
const cache = new Map();

const loadTemplate = (name) => {
  if (!cache.has(name)) cache.set(name, fs.readFileSync(path.join(templateDir, `${name}.html`), 'utf8'));
  return cache.get(name);
};

const escapeHtml = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// {{var}} is HTML-escaped, {{{var}}} is inserted raw (only used for the inner template)
const render = (tpl, vars) =>
  tpl
    .replace(/\{\{\{(\w+)\}\}\}/g, (_, k) => vars[k] ?? '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => escapeHtml(vars[k]));

let transporter;
const getTransporter = () => {
  if (transporter) return transporter;
  if (env.smtp.host) {
    transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
    });
  } else {
    // No SMTP configured: emails are generated but only logged (handy for local development).
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }
  return transporter;
};

export const sendEmail = async ({ to, subject, template, vars = {} }) => {
  const inner = render(loadTemplate(template), { appName: env.appName, ...vars });
  const html = render(loadTemplate('layout'), { appName: env.appName, content: inner });
  const info = await getTransporter().sendMail({ from: env.smtp.from, to, subject, html });
  if (!env.smtp.host && env.nodeEnv !== 'test') console.log(`[EMAIL - SMTP not configured, not actually sent] to=${to} subject="${subject}"`);
  return info;
};

// Emails must never break the main request, so these helpers swallow & log errors.
const safe = (promise, label) =>
  promise.catch((err) => {
    console.error(`[EMAIL ERROR] ${label}:`, err.message);
  });

export const sendRegistrationEmail = (user, token) =>
  safe(
    sendEmail({
      to: user.email,
      subject: `Welcome to ${env.appName} – registration successful`,
      template: 'registration-success',
      vars: { firstName: user.firstName, email: user.email, token, verifyUrl: `${env.baseUrl}/api/auth/verify-email/${token}` },
    }),
    'registration'
  );

export const sendVerificationEmail = (user, token) =>
  safe(
    sendEmail({
      to: user.email,
      subject: 'Verify your email address',
      template: 'verify-email',
      vars: { firstName: user.firstName, token, verifyUrl: `${env.baseUrl}/api/auth/verify-email/${token}` },
    }),
    'verification'
  );

export const sendWelcomeEmail = (user) =>
  safe(sendEmail({ to: user.email, subject: `Welcome to ${env.appName}!`, template: 'welcome', vars: { firstName: user.firstName } }), 'welcome');

export const sendForgotPasswordEmail = (user, token) =>
  sendEmail({
    to: user.email,
    subject: 'Password reset request',
    template: 'forgot-password',
    vars: { firstName: user.firstName, token, resetUrl: `${env.clientUrl}/reset-password?token=${token}` },
  });

export const sendPasswordResetSuccessEmail = (user) =>
  safe(sendEmail({ to: user.email, subject: 'Your password was reset', template: 'password-reset-success', vars: { firstName: user.firstName } }), 'reset-success');

export const sendPasswordChangedEmail = (user) =>
  safe(sendEmail({ to: user.email, subject: 'Your password was changed', template: 'password-changed', vars: { firstName: user.firstName } }), 'password-changed');

import env from '../config/env.js';

// Stored paths look like "/uploads/posts/abc.jpg"; clients receive absolute URLs.
export const absUrl = (p) => {
  if (!p) return p;
  if (/^https?:\/\//i.test(p)) return p;
  return `${env.baseUrl}${p.startsWith('/') ? '' : '/'}${p}`;
};

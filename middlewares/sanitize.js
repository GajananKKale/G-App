// Strips MongoDB operator keys ($where, $ne, ...) and dotted keys from user input (NoSQL injection guard).
const clean = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  for (const key of Object.keys(obj)) {
    if (key.startsWith('$') || key.includes('.')) {
      delete obj[key];
    } else if (typeof obj[key] === 'object') {
      clean(obj[key]);
    }
  }
  return obj;
};

export default function sanitizeInput(req, res, next) {
  req.body = clean(req.body ?? {});
  if (req.params) clean(req.params);
  next();
}

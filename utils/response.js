export const sendSuccess = (res, { status = 200, message = 'Success', data = undefined, meta = undefined } = {}) => {
  const body = { success: true, message };
  if (data !== undefined) body.data = data;
  if (meta !== undefined) body.meta = meta;
  return res.status(status).json(body);
};

export const sendError = (res, status, message, errors) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(status).json(body);
};

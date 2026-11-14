// Single source of truth for the JWT signing/verification secret. server.js
// signs login tokens with this and the requireAuth middleware verifies them
// against it, so both MUST agree.
//
// The dev fallback is public (it's in this repo), so anyone could forge a
// login token for any account with it. In production, refuse to start
// without a real JWT_SECRET rather than silently fall back - e.g. a new
// Render service that boots before its secrets are filled in.
const fromEnv = process.env.JWT_SECRET;
if (!fromEnv && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production (refusing to use the public dev fallback)');
}

module.exports = {
  secretKey: fromEnv || 'your_secret_key',
};

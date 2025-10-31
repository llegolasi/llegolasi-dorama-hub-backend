import app from './hono';

const port = process.env.PORT || 3000;
console.log(`🚀 Server running on http://localhost:${port}`);

export default {
  port: Number(port),
  fetch: app.fetch,
};
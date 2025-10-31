import { handle } from 'hono/vercel';
import { app } from '../hono';

export default handle(app);
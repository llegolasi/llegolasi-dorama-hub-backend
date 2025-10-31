# Backend Server

## Running the Backend

To start the backend server locally:

```bash
cd backend
bun run.ts
```

Or alternatively:

```bash
cd backend
bun run --hot hono.ts
```

The server will start on `http://localhost:3000` and provide:

- Health check: `GET /`
- tRPC endpoints: `POST /api/trpc/*`

## Testing the API

You can test the health endpoint:

```bash
curl http://localhost:3000/
```

Expected response:
```json
{"status":"ok","message":"API is running"}
```

## tRPC Routes

The tRPC router includes:
- `example.hi` - Test mutation
- `community.*` - Community posts
- `news.*` - News articles and comments
- `rankings.*` - User rankings
- `users.*` - User profiles and stats
- `discover.*` - Drama discovery
- `subscription.*` - Premium subscriptions
- `completions.*` - Drama completions
- `dramas.*` - Drama cache and categories
- `comments.reports.*` - Comment reporting

## Environment Variables

Make sure your `.env` file has:

```
EXPO_PUBLIC_RORK_API_BASE_URL=http://localhost:3000
```
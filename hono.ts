import { Hono } from "hono";
import { trpcServer } from "@hono/trpc-server";
import { cors } from "hono/cors";
import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";

const app = new Hono();

// 1️⃣ CORS para todas as rotas
app.use("*", cors());

// 2️⃣ Rota de status (testar se a API está online)
app.get("/", (c) => {
  return c.json({ status: "ok", message: "API is running" });
});

// 3️⃣ Middleware tRPC
// Todas as chamadas para /api/trpc/* vão para o tRPC
app.use(
  "/api/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
  })
);

export default app;

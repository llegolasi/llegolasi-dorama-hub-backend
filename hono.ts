import Hono from "hono";
import { trpcServer } from "@hono/trpc-server";
import { cors } from "hono/cors";
import { appRouter } from "./trpc/app-router";
import { createContext } from "./trpc/create-context";

const app = new Hono();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({ status: "ok", message: "API is running" });
});

app.use(
  "/api/trpc/*",
  trpcServer({
    router: appRouter,
    createContext,
    endpoint: "/api/trpc", // Esta linha foi crucial
  })
);

export default app;
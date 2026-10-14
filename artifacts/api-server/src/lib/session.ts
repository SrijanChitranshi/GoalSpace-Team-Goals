import MongoStore from "connect-mongo";
import session from "express-session";
import type { RequestHandler } from "express";
import mongoose from "mongoose";

const maxAge = 7 * 24 * 60 * 60 * 1000;

export function createSessionMiddleware(): RequestHandler {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET must be configured in Replit Secrets.");
  }

  const client = mongoose.connection.getClient();
  const store = MongoStore.create({
    client,
    collectionName: "goalspace_sessions",
    ttl: maxAge / 1000,
    autoRemove: "native",
  });

  return session({
    name: "goalspace.sid",
    secret,
    store,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge,
      path: "/",
    },
  });
}

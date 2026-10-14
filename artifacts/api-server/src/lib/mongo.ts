import mongoose from "mongoose";
import { logger } from "./logger";

export async function connectMongo(): Promise<void> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI must be configured in Replit Secrets.");
  }

  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15_000 });
  logger.info("MongoDB connected");
}

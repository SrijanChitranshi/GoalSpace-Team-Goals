import { createServer } from "node:http";
import { Server } from "socket.io";
import { Types } from "mongoose";
import { createApp } from "./app";
import { logger } from "./lib/logger";
import { connectMongo } from "./lib/mongo";
import { createSessionMiddleware } from "./lib/session";
import { setSocketServer } from "./lib/realtime";
import { MembershipModel } from "./lib/models";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start(): Promise<void> {
  await connectMongo();
  const sessionMiddleware = createSessionMiddleware();
  const app = createApp(sessionMiddleware);
  const server = createServer(app);
  const io = new Server(server, {
    path: "/socket.io",
    cors: { origin: true, credentials: true },
    serveClient: false,
  });
  setSocketServer(io);
  io.engine.use(sessionMiddleware);

  io.use((socket, next) => {
    const request = socket.request as typeof socket.request & {
      session?: { userId?: string };
    };
    if (!request.session?.userId) {
      next(new Error("Authentication required"));
      return;
    }
    socket.data.userId = request.session.userId;
    next();
  });

  const presence = new Map<string, Map<string, Set<string>>>();
  const roomFor = (workspaceId: string) => `workspace:${workspaceId}`;
  const publishPresence = (workspaceId: string) => {
    const onlineUsers = [...(presence.get(workspaceId)?.keys() ?? [])];
    io.to(roomFor(workspaceId)).emit("presence:update", {
      workspaceId,
      onlineUserIds: onlineUsers,
    });
  };

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    const joinedWorkspaces = new Set<string>();

    socket.on(
      "workspace:join",
      async (
        payload: { workspaceId?: string },
        acknowledge?: (result: { ok: boolean; error?: string }) => void,
      ) => {
        const workspaceId = payload?.workspaceId;
        if (!workspaceId || !Types.ObjectId.isValid(workspaceId)) {
          acknowledge?.({ ok: false, error: "Invalid workspace ID" });
          return;
        }

        const membership = await MembershipModel.findOne({
          workspaceId,
          userId,
          status: "active",
        });
        if (!membership) {
          acknowledge?.({ ok: false, error: "Workspace access denied" });
          return;
        }

        await socket.join(roomFor(workspaceId));
        joinedWorkspaces.add(workspaceId);
        const roomPresence = presence.get(workspaceId) ?? new Map();
        const userSockets = roomPresence.get(userId) ?? new Set();
        userSockets.add(socket.id);
        roomPresence.set(userId, userSockets);
        presence.set(workspaceId, roomPresence);
        publishPresence(workspaceId);
        acknowledge?.({ ok: true });
      },
    );

    socket.on("workspace:leave", async (payload: { workspaceId?: string }) => {
      const workspaceId = payload?.workspaceId;
      if (!workspaceId || !joinedWorkspaces.has(workspaceId)) {
        return;
      }
      await socket.leave(roomFor(workspaceId));
      joinedWorkspaces.delete(workspaceId);
      const roomPresence = presence.get(workspaceId);
      const userSockets = roomPresence?.get(userId);
      userSockets?.delete(socket.id);
      if (userSockets?.size === 0) {
        roomPresence?.delete(userId);
      }
      if (roomPresence?.size === 0) {
        presence.delete(workspaceId);
      }
      publishPresence(workspaceId);
    });

    socket.on("disconnect", () => {
      for (const workspaceId of joinedWorkspaces) {
        const roomPresence = presence.get(workspaceId);
        const userSockets = roomPresence?.get(userId);
        userSockets?.delete(socket.id);
        if (userSockets?.size === 0) {
          roomPresence?.delete(userId);
        }
        if (roomPresence?.size === 0) {
          presence.delete(workspaceId);
        }
        publishPresence(workspaceId);
      }
    });
  });

  server.listen(port, () => {
    logger.info({ port }, "Server listening");
  });
}

start().catch((err: unknown) => {
  logger.error({ err }, "Unable to start API server");
  process.exit(1);
});

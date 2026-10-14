import type { Server } from "socket.io";

let io: Server | undefined;

export function setSocketServer(server: Server): void {
  io = server;
}

export function emitWorkspaceEvent(
  workspaceId: string,
  event: string,
  payload: unknown,
): void {
  io?.to(`workspace:${workspaceId}`).emit(event, payload);
}

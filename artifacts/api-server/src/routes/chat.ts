import { Router, type IRouter } from "express";
import { Types } from "mongoose";
import {
  CreateMessageBody,
  CreateMessageResponse,
  DeleteMessageParams,
  DeleteMessageResponse,
  EditMessageBody,
  EditMessageParams,
  EditMessageResponse,
  ListMessagesParams,
  ListMessagesQueryParams,
  ListMessagesResponse,
} from "@workspace/api-zod";
import { MessageModel, UserModel } from "../lib/models";
import {
  asString,
  can,
  objectId,
  requireWorkspace,
  validId,
} from "../lib/goalspace";
import { emitWorkspaceEvent } from "../lib/realtime";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();
router.use(requireAuth);

async function serializeMessage(message: {
  _id: Types.ObjectId;
  workspaceId: Types.ObjectId;
  senderId: Types.ObjectId;
  kind: "user" | "system";
  text: string;
  replyToId: Types.ObjectId | null;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}) {
  const sender = await UserModel.findById(message.senderId)
    .select("name avatar")
    .lean();
  return {
    id: message._id.toString(),
    workspaceId: message.workspaceId.toString(),
    senderId: message.kind === "system" ? "system" : message.senderId.toString(),
    senderName: message.kind === "system" ? "GoalSpace" : sender?.name ?? "Former member",
    senderAvatar: message.kind === "system" ? null : sender?.avatar ?? null,
    text: message.deletedAt ? "Message deleted" : message.text,
    replyToId: message.replyToId?.toString() ?? null,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    deleted: Boolean(message.deletedAt),
  };
}

router.get(
  "/workspaces/:workspaceId/messages",
  async (req, res): Promise<void> => {
    const params = ListMessagesParams.safeParse(req.params);
    const query = ListMessagesQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Invalid message request" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
    );
    if (!membership) {
      return;
    }
    const limit = query.data.limit ?? 50;
    const filter: Record<string, unknown> = { workspaceId };
    if (query.data.before && validId(query.data.before)) {
      const cursor = await MessageModel.findOne({
        _id: query.data.before,
        workspaceId,
      }).select("createdAt");
      if (cursor) {
        filter.createdAt = { $lt: cursor.createdAt };
      }
    }
    const records = await MessageModel.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit + 1)
      .lean();
    const hasMore = records.length > limit;
    const page = (hasMore ? records.slice(0, limit) : records).reverse();
    const items = await Promise.all(page.map(serializeMessage));
    const response = {
      items,
      nextCursor: hasMore ? page[0]?._id.toString() ?? null : null,
    };
    res.json(ListMessagesResponse.parse(response));
  },
);

router.post(
  "/workspaces/:workspaceId/messages",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "sendMessages",
    );
    if (!membership) {
      return;
    }
    const parsed = CreateMessageBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    let replyToId: Types.ObjectId | null = null;
    if (parsed.data.replyToId) {
      if (!validId(parsed.data.replyToId)) {
        res.status(400).json({ error: "Reply target is invalid" });
        return;
      }
      const reply = await MessageModel.exists({
        _id: parsed.data.replyToId,
        workspaceId,
      });
      if (!reply) {
        res.status(404).json({ error: "Reply target not found" });
        return;
      }
      replyToId = objectId(parsed.data.replyToId);
    }
    const message = await MessageModel.create({
      workspaceId: objectId(workspaceId),
      senderId: membership.userId,
      kind: "user",
      text: parsed.data.text.trim(),
      replyToId,
      editedAt: null,
      deletedAt: null,
    });
    const output = await serializeMessage(message);
    res.status(201).json(CreateMessageResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "chat:new", output);
  },
);

router.patch(
  "/workspaces/:workspaceId/messages/:messageId",
  async (req, res): Promise<void> => {
    const params = EditMessageParams.safeParse(req.params);
    const parsed = EditMessageBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid message update" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const messageId = asString(params.data.messageId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
    );
    if (!membership) {
      return;
    }
    const message = await MessageModel.findOne({
      _id: messageId,
      workspaceId,
      deletedAt: null,
    });
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (message.kind === "system") {
      res.status(403).json({ error: "System activity messages cannot be edited" });
      return;
    }
    const isSender = message.senderId.toString() === membership.userId.toString();
    if (
      !can(membership, "moderateChat") &&
      !(isSender && can(membership, "editOwnMessages"))
    ) {
      res.status(403).json({ error: "You cannot edit this message" });
      return;
    }
    message.text = parsed.data.text.trim();
    message.editedAt = new Date();
    await message.save();
    const output = await serializeMessage(message);
    res.json(EditMessageResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "chat:edited", output);
  },
);

router.delete(
  "/workspaces/:workspaceId/messages/:messageId",
  async (req, res): Promise<void> => {
    const params = DeleteMessageParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid message ID" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const messageId = asString(params.data.messageId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
    );
    if (!membership) {
      return;
    }
    const message = await MessageModel.findOne({
      _id: messageId,
      workspaceId,
      deletedAt: null,
    });
    if (!message) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (message.kind === "system") {
      res.status(403).json({ error: "System activity messages cannot be deleted" });
      return;
    }
    const isSender = message.senderId.toString() === membership.userId.toString();
    if (
      !can(membership, "moderateChat") &&
      !(isSender && can(membership, "deleteOwnMessages"))
    ) {
      res.status(403).json({ error: "You cannot delete this message" });
      return;
    }
    message.deletedAt = new Date();
    await message.save();
    res.json(DeleteMessageResponse.parse({ success: true }));
    emitWorkspaceEvent(workspaceId, "chat:deleted", {
      id: messageId,
      deleted: true,
    });
  },
);

export default router;

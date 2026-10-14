import type { Response } from "express";
import { Types, type ClientSession } from "mongoose";
import {
  ActivityLogModel,
  MembershipModel,
  UserModel,
  type FieldChangeShape,
  type MembershipShape,
  type PermissionKey,
} from "./models";

export function asString(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function validId(value: string): boolean {
  return Types.ObjectId.isValid(value);
}

export function objectId(value: string): Types.ObjectId {
  return new Types.ObjectId(value);
}

export function serializeUser(user: {
  _id: Types.ObjectId;
  name: string;
  email: string;
  avatar: string | null;
}) {
  return {
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    avatar: user.avatar ?? null,
  };
}

export async function requireWorkspace(
  userId: string | undefined,
  workspaceId: string,
  res: Response,
  permission?: PermissionKey,
) {
  if (!userId) {
    res.status(401).json({ error: "Authentication required" });
    return null;
  }
  if (!validId(workspaceId)) {
    res.status(404).json({ error: "Workspace not found" });
    return null;
  }

  const membership = await MembershipModel.findOne({
    workspaceId: objectId(workspaceId),
    userId: objectId(userId),
    status: "active",
  });
  if (!membership) {
    res.status(403).json({ error: "Workspace access denied" });
    return null;
  }

  if (
    permission &&
    membership.role !== "owner" &&
    !membership.permissions[permission]
  ) {
    res.status(403).json({ error: "You do not have permission to do that" });
    return null;
  }

  return membership;
}

export function can(
  membership: Pick<MembershipShape, "role" | "permissions">,
  permission: PermissionKey,
): boolean {
  return membership.role === "owner" || membership.permissions[permission];
}

export async function writeActivity(input: {
  workspaceId: Types.ObjectId;
  actorId: Types.ObjectId;
  action: string;
  goalId?: Types.ObjectId | null;
  goalTitle?: string | null;
  changes?: FieldChangeShape[];
  metadata?: Record<string, string>;
  session?: ClientSession;
}): Promise<void> {
  const activity = new ActivityLogModel({
    workspaceId: input.workspaceId,
    actorId: input.actorId,
    action: input.action,
    goalId: input.goalId ?? null,
    goalTitle: input.goalTitle ?? null,
    changes: input.changes ?? [],
    metadata: input.metadata ?? {},
  });
  if (input.session) {
    await activity.save({ session: input.session });
  } else {
    await activity.save();
  }
}

export async function actorProfile(actorId: string) {
  if (!validId(actorId)) {
    return null;
  }
  return UserModel.findById(actorId).select("name avatar").lean();
}

export function fieldChange(
  field: string,
  previousValue: unknown,
  newValue: unknown,
): FieldChangeShape {
  const stringify = (value: unknown): string | null => {
    if (value === null || value === undefined) {
      return null;
    }
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    if (Array.isArray(value)) {
      return value.map((item) => String(item)).join(", ");
    }
    return String(value);
  };

  return {
    field,
    previousValue: stringify(previousValue),
    newValue: stringify(newValue),
  };
}

import { createHash, randomBytes } from "node:crypto";
import { Router, type IRouter, type Request } from "express";
import mongoose, { Types } from "mongoose";
import {
  CreateInvitationBody,
  CreateInvitationResponse,
  CreateWorkspaceBody,
  CreateWorkspaceResponse,
  DecideJoinRequestBody,
  DecideJoinRequestResponse,
  GetWorkspaceResponse,
  GetWorkspaceSummaryResponse,
  ListJoinRequestsResponse,
  ListMembersResponse,
  ListWorkspacesResponse,
  RemoveMemberParams,
  RemoveMemberResponse,
  RevokeInvitationParams,
  RevokeInvitationResponse,
  UpdateMemberPermissionsBody,
  UpdateMemberPermissionsResponse,
  UpdateMemberRoleBody,
  UpdateMemberRoleResponse,
  UpdateWorkspaceBody,
  UpdateWorkspaceResponse,
  JoinWithInvitationBody,
  JoinWithInvitationResponse,
} from "@workspace/api-zod";
import {
  ActivityLogModel,
  GoalModel,
  InvitationModel,
  JoinRequestModel,
  MembershipModel,
  UserModel,
  WorkspaceModel,
  allPermissions,
  defaultAdminPermissions,
  defaultMemberPermissions,
  permissionKeys,
  type PermissionSet,
} from "../lib/models";
import {
  asString,
  fieldChange,
  objectId,
  requireWorkspace,
  serializeUser,
  validId,
  writeActivity,
} from "../lib/goalspace";
import { emitWorkspaceEvent } from "../lib/realtime";
import { requireAuth } from "../middlewares/auth";

export const workspaceRouter: IRouter = Router();
export const invitationJoinRouter: IRouter = Router();

workspaceRouter.use(requireAuth);
invitationJoinRouter.use(requireAuth);

function serializeWorkspace(
  workspace: {
    _id: Types.ObjectId;
    name: string;
    workspaceCode: string;
    ownerId: Types.ObjectId;
    approvalRequired: boolean;
    createdAt: Date;
  },
  role: "owner" | "admin" | "member",
) {
  return {
    id: workspace._id.toString(),
    name: workspace.name,
    workspaceCode: workspace.workspaceCode,
    ownerId: workspace.ownerId.toString(),
    approvalRequired: workspace.approvalRequired,
    role,
    createdAt: workspace.createdAt.toISOString(),
  };
}

function workspaceCode(): string {
  return randomBytes(5).toString("hex").toUpperCase();
}

function invitationHash(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

function actorObjectId(req: Request) {
  return objectId(req.session.userId ?? "");
}

workspaceRouter.get("/", async (req, res): Promise<void> => {
  const userId = objectId(req.session.userId ?? "");
  const memberships = await MembershipModel.find({
    userId,
    status: "active",
  }).lean();
  const workspaces = await WorkspaceModel.find({
    _id: { $in: memberships.map((item) => item.workspaceId) },
  }).lean();
  const roleByWorkspace = new Map(
    memberships.map((item) => [item.workspaceId.toString(), item.role]),
  );
  const response = {
    items: workspaces.map((workspace) =>
      serializeWorkspace(
        workspace,
        roleByWorkspace.get(workspace._id.toString()) ?? "member",
      ),
    ),
  };
  res.json(ListWorkspacesResponse.parse(response));
});

workspaceRouter.post("/", async (req, res): Promise<void> => {
  const parsed = CreateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const session = await mongoose.startSession();
  let created:
    | {
        workspace: Awaited<ReturnType<typeof WorkspaceModel.create>>[number];
      }
    | undefined;
  try {
    await session.withTransaction(async () => {
      const workspace = new WorkspaceModel({
        name: parsed.data.name.trim(),
        workspaceCode: workspaceCode(),
        ownerId: actorObjectId(req),
        approvalRequired: parsed.data.approvalRequired ?? false,
      });
      await workspace.save({ session });
      const ownerMembership = new MembershipModel({
        workspaceId: workspace._id,
        userId: actorObjectId(req),
        role: "owner",
        permissions: allPermissions,
        permissionCeiling: allPermissions,
        status: "active",
      });
      await ownerMembership.save({ session });
      await writeActivity({
        workspaceId: workspace._id,
        actorId: actorObjectId(req),
        action: "workspace.created",
        metadata: { workspaceName: workspace.name },
        session,
      });
      created = { workspace };
    });
  } finally {
    await session.endSession();
  }

  if (!created) {
    res.status(500).json({ error: "Workspace could not be created" });
    return;
  }
  const output = serializeWorkspace(created.workspace, "owner");
  res.status(201).json(CreateWorkspaceResponse.parse(output));
  emitWorkspaceEvent(output.id, "activity:new", {
    action: "workspace.created",
    createdAt: new Date().toISOString(),
  });
});

workspaceRouter.get("/:workspaceId/summary", async (req, res): Promise<void> => {
  const workspaceId = asString(req.params.workspaceId);
  const membership = await requireWorkspace(
    req.session.userId,
    workspaceId,
    res,
    "viewGoals",
  );
  if (!membership) {
    return;
  }

  const id = objectId(workspaceId);
  const now = new Date();
  const [totalGoals, completedGoals, overdueGoals, memberCount, upcoming, recentActivity] =
    await Promise.all([
      GoalModel.countDocuments({
        workspaceId: id,
        deletedAt: null,
      }),
      GoalModel.countDocuments({
        workspaceId: id,
        deletedAt: null,
        status: "completed",
      }),
      GoalModel.countDocuments({
        workspaceId: id,
        deletedAt: null,
        deadline: { $lt: now },
        status: { $ne: "completed" },
      }),
      MembershipModel.countDocuments({ workspaceId: id, status: "active" }),
      GoalModel.find({
        workspaceId: id,
        deletedAt: null,
        deadline: { $gte: now },
        status: { $ne: "completed" },
      })
        .sort({ deadline: 1 })
        .limit(5)
        .lean(),
      ActivityLogModel.find({ workspaceId: id })
        .sort({ createdAt: -1 })
        .limit(6)
        .populate("actorId", "name avatar")
        .lean(),
    ]);

  const pendingGoals = Math.max(0, totalGoals - completedGoals);
  const upcomingItems = await Promise.all(
    upcoming.map((goal) => serializeGoal(goal)),
  );
  const activityItems = recentActivity.map((entry) => {
    const actor = entry.actorId as unknown as {
      _id: Types.ObjectId;
      name: string;
      avatar: string | null;
    };
    return serializeActivity(entry, actor);
  });
  res.json(
    GetWorkspaceSummaryResponse.parse({
      totalGoals,
      completedGoals,
      pendingGoals,
      overdueGoals,
      completionPercent:
        totalGoals === 0 ? 0 : Math.round((completedGoals / totalGoals) * 100),
      memberCount,
      upcoming: upcomingItems,
      recentActivity: activityItems,
    }),
  );
});

workspaceRouter.get("/:workspaceId", async (req, res): Promise<void> => {
  const workspaceId = asString(req.params.workspaceId);
  const membership = await requireWorkspace(
    req.session.userId,
    workspaceId,
    res,
  );
  if (!membership) {
    return;
  }
  const workspace = await WorkspaceModel.findById(workspaceId).lean();
  if (!workspace) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  res.json(
    GetWorkspaceResponse.parse(
      serializeWorkspace(workspace, membership.role),
    ),
  );
});

workspaceRouter.patch("/:workspaceId", async (req, res): Promise<void> => {
  const workspaceId = asString(req.params.workspaceId);
  const membership = await requireWorkspace(
    req.session.userId,
    workspaceId,
    res,
  );
  if (!membership) {
    return;
  }
  if (membership.role !== "owner") {
    res.status(403).json({ error: "Only the owner can change workspace settings" });
    return;
  }
  const parsed = UpdateWorkspaceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  if (Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Provide at least one setting to update" });
    return;
  }

  const session = await mongoose.startSession();
  let updated:
    | {
        _id: Types.ObjectId;
        name: string;
        workspaceCode: string;
        ownerId: Types.ObjectId;
        approvalRequired: boolean;
        createdAt: Date;
      }
    | undefined;
  try {
    await session.withTransaction(async () => {
      const workspace = await WorkspaceModel.findById(workspaceId).session(session);
      if (!workspace) {
        return;
      }
      const changes = [];
      if (
        parsed.data.name !== undefined &&
        parsed.data.name !== workspace.name
      ) {
        changes.push(fieldChange("name", workspace.name, parsed.data.name));
        workspace.name = parsed.data.name.trim();
      }
      if (
        parsed.data.approvalRequired !== undefined &&
        parsed.data.approvalRequired !== workspace.approvalRequired
      ) {
        changes.push(
          fieldChange(
            "approvalRequired",
            workspace.approvalRequired,
            parsed.data.approvalRequired,
          ),
        );
        workspace.approvalRequired = parsed.data.approvalRequired;
      }
      await workspace.save({ session });
      if (changes.length) {
        await writeActivity({
          workspaceId: workspace._id,
          actorId: actorObjectId(req),
          action: "workspace.settings_changed",
          changes,
          session,
        });
      }
      updated = {
        _id: workspace._id,
        name: workspace.name,
        workspaceCode: workspace.workspaceCode,
        ownerId: workspace.ownerId,
        approvalRequired: workspace.approvalRequired,
        createdAt: workspace.createdAt,
      };
    });
  } finally {
    await session.endSession();
  }

  if (!updated) {
    res.status(404).json({ error: "Workspace not found" });
    return;
  }
  const output = serializeWorkspace(updated, "owner");
  res.json(UpdateWorkspaceResponse.parse(output));
  emitWorkspaceEvent(workspaceId, "activity:new", {
    action: "workspace.settings_changed",
    createdAt: new Date().toISOString(),
  });
});

workspaceRouter.post(
  "/:workspaceId/invitations",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "inviteMembers",
    );
    if (!membership) {
      return;
    }
    const parsed = CreateInvitationBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }

    const code = `GS-${randomBytes(18).toString("base64url")}`;
    const expiresAt = new Date(
      Date.now() + (parsed.data.expiresInDays ?? 7) * 24 * 60 * 60 * 1000,
    );
    const invitation = await InvitationModel.create({
      workspaceId: objectId(workspaceId),
      secretHash: invitationHash(code),
      creatorId: actorObjectId(req),
      expiresAt,
      usageLimit: parsed.data.usageLimit ?? null,
      usageCount: 0,
      revokedAt: null,
    });
    await writeActivity({
      workspaceId: objectId(workspaceId),
      actorId: actorObjectId(req),
      action: "invitation.created",
      metadata: { invitationId: invitation._id.toString() },
    });
    const output = {
      id: invitation._id.toString(),
      code,
      expiresAt: expiresAt.toISOString(),
      usageLimit: invitation.usageLimit,
    };
    res.status(201).json(CreateInvitationResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: "invitation.created",
      createdAt: new Date().toISOString(),
    });
  },
);

workspaceRouter.delete(
  "/:workspaceId/invitations/:invitationId",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const invitationId = asString(req.params.invitationId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "inviteMembers",
    );
    if (!membership) {
      return;
    }
    if (!validId(invitationId)) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    const invitation = await InvitationModel.findOneAndUpdate(
      {
        _id: invitationId,
        workspaceId,
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
      { new: true },
    );
    if (!invitation) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    await writeActivity({
      workspaceId: objectId(workspaceId),
      actorId: actorObjectId(req),
      action: "invitation.revoked",
      metadata: { invitationId },
    });
    res.json(RevokeInvitationResponse.parse({ success: true }));
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: "invitation.revoked",
      createdAt: new Date().toISOString(),
    });
  },
);

invitationJoinRouter.post("/join", async (req, res): Promise<void> => {
  const parsed = JoinWithInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const userId = objectId(req.session.userId ?? "");
  const invitation = await InvitationModel.findOne({
    secretHash: invitationHash(parsed.data.code),
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (
    !invitation ||
    (invitation.usageLimit !== null &&
      invitation.usageCount >= invitation.usageLimit)
  ) {
    res.status(400).json({ error: "This invitation is invalid, expired, or used up" });
    return;
  }
  const workspace = await WorkspaceModel.findById(invitation.workspaceId);
  if (!workspace) {
    res.status(400).json({ error: "This invitation is no longer valid" });
    return;
  }
  const existing = await MembershipModel.findOne({
    workspaceId: workspace._id,
    userId,
    status: "active",
  });
  if (existing) {
    res.status(409).json({ error: "You are already a member of this workspace" });
    return;
  }

  if (workspace.approvalRequired) {
    const session = await mongoose.startSession();
    let createdRequestId = "";
    try {
      await session.withTransaction(async () => {
        const use = await InvitationModel.findOneAndUpdate(
          {
            _id: invitation._id,
            revokedAt: null,
            expiresAt: { $gt: new Date() },
            $or: [
              { usageLimit: null },
              { $expr: { $lt: ["$usageCount", "$usageLimit"] } },
            ],
          },
          { $inc: { usageCount: 1 } },
          { new: true, session },
        );
        if (!use) {
          throw new Error("INVITATION_UNAVAILABLE");
        }
        const joinRequest = await JoinRequestModel.findOneAndUpdate(
          { workspaceId: workspace._id, userId },
          { $set: { status: "pending" } },
          { upsert: true, new: true, setDefaultsOnInsert: true, session },
        );
        if (!joinRequest) {
          throw new Error("JOIN_REQUEST_NOT_CREATED");
        }
        createdRequestId = joinRequest._id.toString();
        await writeActivity({
          workspaceId: workspace._id,
          actorId: userId,
          action: "join_request.created",
          metadata: { requestId: createdRequestId },
          session,
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "INVITATION_UNAVAILABLE") {
        res.status(400).json({ error: "This invitation is invalid, expired, or used up" });
        return;
      }
      throw error;
    } finally {
      await session.endSession();
    }
    emitWorkspaceEvent(workspace._id.toString(), "activity:new", {
      action: "join_request.created",
      createdAt: new Date().toISOString(),
    });
    res.json(
      JoinWithInvitationResponse.parse({
        status: "pending",
        workspace: null,
      }),
    );
    return;
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const use = await InvitationModel.findOneAndUpdate(
        {
          _id: invitation._id,
          revokedAt: null,
          expiresAt: { $gt: new Date() },
          $or: [
            { usageLimit: null },
            { $expr: { $lt: ["$usageCount", "$usageLimit"] } },
          ],
        },
        { $inc: { usageCount: 1 } },
        { new: true, session },
      );
      if (!use) {
        throw new Error("INVITATION_UNAVAILABLE");
      }
      await MembershipModel.create(
        [
          {
            workspaceId: workspace._id,
            userId,
            role: "member",
            permissions: defaultMemberPermissions,
            permissionCeiling: defaultMemberPermissions,
            status: "active",
          },
        ],
        { session },
      );
      await writeActivity({
        workspaceId: workspace._id,
        actorId: userId,
        action: "member.added",
        metadata: { userId: userId.toString() },
        session,
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_UNAVAILABLE") {
      res.status(400).json({ error: "This invitation is invalid, expired, or used up" });
      return;
    }
    throw error;
  } finally {
    await session.endSession();
  }

  const roleMembership = await MembershipModel.findOne({
    workspaceId: workspace._id,
    userId,
  });
  const output = {
    status: "joined" as const,
    workspace: serializeWorkspace(workspace, roleMembership?.role ?? "member"),
  };
  res.json(JoinWithInvitationResponse.parse(output));
  emitWorkspaceEvent(workspace._id.toString(), "activity:new", {
    action: "member.added",
    createdAt: new Date().toISOString(),
  });
});

workspaceRouter.get(
  "/:workspaceId/join-requests",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "approveJoinRequests",
    );
    if (!membership) {
      return;
    }
    const requests = await JoinRequestModel.find({
      workspaceId,
      status: "pending",
    })
      .sort({ createdAt: -1 })
      .populate("userId", "name email")
      .lean();
    const output = requests.map((request) => {
      const user = request.userId as unknown as {
        _id: Types.ObjectId;
        name: string;
        email: string;
      };
      return {
        id: request._id.toString(),
        userId: user._id.toString(),
        name: user.name,
        email: user.email,
        status: request.status,
        createdAt: request.createdAt.toISOString(),
      };
    });
    res.json(ListJoinRequestsResponse.parse(output));
  },
);

workspaceRouter.patch(
  "/:workspaceId/join-requests/:requestId",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const requestId = asString(req.params.requestId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "approveJoinRequests",
    );
    if (!membership) {
      return;
    }
    const parsed = DecideJoinRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const joinRequest = await JoinRequestModel.findOne({
      _id: requestId,
      workspaceId,
      status: "pending",
    });
    if (!joinRequest) {
      res.status(404).json({ error: "Pending join request not found" });
      return;
    }

    const nextStatus = parsed.data.decision === "approve" ? "approved" : "rejected";
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        joinRequest.status = nextStatus;
        await joinRequest.save({ session });
        if (nextStatus === "approved") {
          await MembershipModel.findOneAndUpdate(
            {
              workspaceId: objectId(workspaceId),
              userId: joinRequest.userId,
            },
            {
              $set: { status: "active" },
              $setOnInsert: {
                role: "member",
                permissions: defaultMemberPermissions,
                permissionCeiling: defaultMemberPermissions,
                joinedAt: new Date(),
              },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true, session },
          );
        }
        await writeActivity({
          workspaceId: objectId(workspaceId),
          actorId: actorObjectId(req),
          action: `join_request.${nextStatus}`,
          metadata: {
            requestId,
            userId: joinRequest.userId.toString(),
          },
          session,
        });
      });
    } finally {
      await session.endSession();
    }

    const user = await UserModel.findById(joinRequest.userId).lean();
    const output = {
      id: joinRequest._id.toString(),
      userId: joinRequest.userId.toString(),
      name: user?.name ?? "Workspace member",
      email: user?.email ?? "",
      status: joinRequest.status,
      createdAt: joinRequest.createdAt.toISOString(),
    };
    res.json(DecideJoinRequestResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: `join_request.${nextStatus}`,
      createdAt: new Date().toISOString(),
    });
    if (nextStatus === "approved") {
      emitWorkspaceEvent(workspaceId, "members:updated", {
        workspaceId,
        userId: joinRequest.userId.toString(),
      });
    }
  },
);

workspaceRouter.get("/:workspaceId/members", async (req, res): Promise<void> => {
  const workspaceId = asString(req.params.workspaceId);
  const viewer = await requireWorkspace(req.session.userId, workspaceId, res);
  if (!viewer) {
    return;
  }
  const memberships = await MembershipModel.find({
    workspaceId,
    status: "active",
  })
    .sort({ joinedAt: 1 })
    .lean();
  const output = await Promise.all(
    memberships.map(async (membership) => {
      const user = await UserModel.findById(membership.userId).lean();
      if (!user) {
        return null;
      }
      return {
        ...serializeUser(user),
        role: membership.role,
        permissions:
          membership.role === "owner" ? allPermissions : membership.permissions,
        joinedAt: membership.joinedAt.toISOString(),
      };
    }),
  );
  res.json(ListMembersResponse.parse(output.filter((item) => item !== null)));
});

workspaceRouter.patch(
  "/:workspaceId/members/:userId/role",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const targetUserId = asString(req.params.userId);
    const actor = await requireWorkspace(req.session.userId, workspaceId, res);
    if (!actor) {
      return;
    }
    if (actor.role !== "owner") {
      res.status(403).json({ error: "Only the owner can change member roles" });
      return;
    }
    const parsed = UpdateMemberRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const target = await MembershipModel.findOne({
      workspaceId,
      userId: targetUserId,
      status: "active",
    });
    if (!target || target.role === "owner") {
      res.status(404).json({ error: "Member not found or role is protected" });
      return;
    }
    const previousRole = target.role;
    target.role = parsed.data.role;
    if (target.role === "admin" && previousRole !== "admin") {
      target.permissions = { ...defaultAdminPermissions };
      target.permissionCeiling = { ...defaultAdminPermissions };
    }
    if (target.role === "member" && previousRole !== "member") {
      target.permissions = { ...defaultMemberPermissions };
      target.permissionCeiling = { ...defaultMemberPermissions };
    }
    await target.save();
    const user = await UserModel.findById(target.userId).lean();
    if (!user) {
      res.status(404).json({ error: "Member profile not found" });
      return;
    }
    await writeActivity({
      workspaceId: objectId(workspaceId),
      actorId: actorObjectId(req),
      action:
        target.role === "admin" ? "member.promoted" : "member.demoted",
      changes: [fieldChange("role", previousRole, target.role)],
      metadata: { userId: targetUserId },
    });
    const output = {
      ...serializeUser(user),
      role: target.role,
      permissions: target.permissions,
      joinedAt: target.joinedAt.toISOString(),
    };
    res.json(UpdateMemberRoleResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "members:updated", {
      workspaceId,
      userId: targetUserId,
      role: target.role,
    });
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: target.role === "admin" ? "member.promoted" : "member.demoted",
      createdAt: new Date().toISOString(),
    });
  },
);

workspaceRouter.patch(
  "/:workspaceId/members/:userId/permissions",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const targetUserId = asString(req.params.userId);
    const actor = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "manageMemberPermissions",
    );
    if (!actor) {
      return;
    }
    const parsed = UpdateMemberPermissionsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const target = await MembershipModel.findOne({
      workspaceId,
      userId: targetUserId,
      status: "active",
    });
    if (!target || target.role === "owner") {
      res.status(404).json({ error: "Member not found or role is protected" });
      return;
    }
    const requested = parsed.data.permissions as PermissionSet;
    if (actor.role !== "owner") {
      if (
        actor.userId.toString() === target.userId.toString() ||
        target.role === "admin"
      ) {
        res.status(403).json({ error: "Admins cannot change their own or another admin's permissions" });
        return;
      }
      const exceedsOwnerLimits = permissionKeys.some(
        (key) => requested[key] && !target.permissionCeiling[key],
      );
      if (exceedsOwnerLimits) {
        res.status(403).json({ error: "The owner has restricted one or more permissions" });
        return;
      }
    } else {
      target.permissionCeiling = { ...requested };
    }

    const changes = permissionKeys
      .filter((key) => target.permissions[key] !== requested[key])
      .map((key) =>
        fieldChange(`permissions.${key}`, target.permissions[key], requested[key]),
      );
    target.permissions = { ...requested };
    await target.save();
    const user = await UserModel.findById(target.userId).lean();
    if (!user) {
      res.status(404).json({ error: "Member profile not found" });
      return;
    }
    await writeActivity({
      workspaceId: objectId(workspaceId),
      actorId: actorObjectId(req),
      action: "member.permissions_changed",
      changes,
      metadata: { userId: targetUserId },
    });
    const output = {
      ...serializeUser(user),
      role: target.role,
      permissions: target.permissions,
      joinedAt: target.joinedAt.toISOString(),
    };
    res.json(UpdateMemberPermissionsResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "members:updated", {
      workspaceId,
      userId: targetUserId,
      permissions: target.permissions,
    });
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: "member.permissions_changed",
      createdAt: new Date().toISOString(),
    });
  },
);

workspaceRouter.delete(
  "/:workspaceId/members/:userId",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const targetUserId = asString(req.params.userId);
    const actor = await requireWorkspace(req.session.userId, workspaceId, res);
    if (!actor) {
      return;
    }
    if (actor.role !== "owner") {
      res.status(403).json({ error: "Only the owner can remove members" });
      return;
    }
    const target = await MembershipModel.findOne({
      workspaceId,
      userId: targetUserId,
      status: "active",
    });
    if (!target || target.role === "owner") {
      res.status(404).json({ error: "Member not found or role is protected" });
      return;
    }
    target.status = "removed";
    await target.save();
    const user = await UserModel.findById(target.userId).lean();
    await writeActivity({
      workspaceId: objectId(workspaceId),
      actorId: actorObjectId(req),
      action: "member.removed",
      changes: [
        fieldChange("membership", user?.name ?? targetUserId, "removed"),
      ],
      metadata: { userId: targetUserId },
    });
    res.json(RemoveMemberResponse.parse({ success: true }));
    emitWorkspaceEvent(workspaceId, "members:updated", {
      workspaceId,
      userId: targetUserId,
      removed: true,
    });
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: "member.removed",
      createdAt: new Date().toISOString(),
    });
  },
);

export function serializeGoal(
  goal: {
    _id: Types.ObjectId;
    workspaceId: Types.ObjectId;
    title: string;
    description: string;
    period: string;
    startDate: Date | null;
    deadline: Date | null;
    priority: string;
    status: string;
    progress: number;
    creatorId: Types.ObjectId;
    assignees: Types.ObjectId[];
    lastEditorId: Types.ObjectId | null;
    version: number;
    createdAt?: Date;
    updatedAt?: Date;
  },
  names?: Map<string, string>,
) {
  if (!goal.createdAt || !goal.updatedAt) {
    throw new Error("Goal timestamps are missing");
  }
  return {
    id: goal._id.toString(),
    workspaceId: goal.workspaceId.toString(),
    title: goal.title,
    description: goal.description,
    period: goal.period,
    startDate: goal.startDate?.toISOString() ?? null,
    deadline: goal.deadline?.toISOString() ?? null,
    priority: goal.priority,
    status: goal.status,
    progress: goal.progress,
    creatorId: goal.creatorId.toString(),
    creatorName: names?.get(goal.creatorId.toString()) ?? "Team member",
    assignees: goal.assignees.map((id) => ({
      userId: id.toString(),
      name: names?.get(id.toString()) ?? "Team member",
    })),
    lastEditorId: goal.lastEditorId?.toString() ?? null,
    lastEditorName: goal.lastEditorId
      ? (names?.get(goal.lastEditorId.toString()) ?? "Team member")
      : null,
    version: goal.version,
    createdAt: goal.createdAt.toISOString(),
    updatedAt: goal.updatedAt.toISOString(),
  };
}

export function serializeActivity(
  entry: {
    _id: Types.ObjectId;
    workspaceId: Types.ObjectId;
    goalId: Types.ObjectId | null;
    goalTitle: string | null;
    actorId: Types.ObjectId;
    action: string;
    changes: Array<{
      field: string;
      previousValue: string | null;
      newValue: string | null;
    }>;
    createdAt: Date;
  },
  actor?: { _id: Types.ObjectId; name: string; avatar: string | null } | null,
) {
  const actorId = actor?._id ?? entry.actorId;
  return {
    id: entry._id.toString(),
    workspaceId: entry.workspaceId.toString(),
    goalId: entry.goalId?.toString() ?? null,
    goalTitle: entry.goalTitle,
    actorId: actorId.toString(),
    actorName: actor?.name ?? "Former member",
    actorAvatar: actor?.avatar ?? null,
    action: entry.action,
    changes: entry.changes.map((change) => ({
      field: change.field,
      previousValue: change.previousValue,
      newValue: change.newValue,
    })),
    createdAt: entry.createdAt.toISOString(),
  };
}


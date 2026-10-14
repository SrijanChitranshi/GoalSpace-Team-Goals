import { Router, type IRouter } from "express";
import mongoose, { Types, type HydratedDocument } from "mongoose";
import {
  ActivityLogModel,
  GoalModel,
  MembershipModel,
  MessageModel,
  UserModel,
  type GoalShape,
} from "../lib/models";
import {
  CreateGoalBody,
  CreateGoalResponse,
  DeleteGoalParams,
  DeleteGoalResponse,
  GetGoalHistoryParams,
  GetGoalHistoryResponse,
  GetGoalParams,
  GetGoalResponse,
  ListActivityParams,
  ListActivityQueryParams,
  ListActivityResponse,
  ListGoalsParams,
  ListGoalsQueryParams,
  ListGoalsResponse,
  UpdateGoalBody,
  UpdateGoalParams,
  UpdateGoalResponse,
} from "@workspace/api-zod";
import {
  asString,
  can,
  fieldChange,
  objectId,
  requireWorkspace,
  validId,
  writeActivity,
} from "../lib/goalspace";
import { emitWorkspaceEvent } from "../lib/realtime";
import { requireAuth } from "../middlewares/auth";
import { serializeActivity, serializeGoal } from "./workspaces";

const router: IRouter = Router();
router.use(requireAuth);

async function goalNames(goal: {
  creatorId: Types.ObjectId;
  assignees: Types.ObjectId[];
  lastEditorId: Types.ObjectId | null;
}): Promise<Map<string, string>> {
  const ids = [
    goal.creatorId,
    ...goal.assignees,
    ...(goal.lastEditorId ? [goal.lastEditorId] : []),
  ];
  const users = await UserModel.find({ _id: { $in: ids } })
    .select("name")
    .lean();
  return new Map(users.map((user) => [user._id.toString(), user.name]));
}

function denied(res: Parameters<Parameters<IRouter["get"]>[1]>[1]) {
  res.status(403).json({ error: "You do not have permission to do that" });
}

router.get(
  "/workspaces/:workspaceId/goals",
  async (req, res): Promise<void> => {
    const params = ListGoalsParams.safeParse(req.params);
    const query = ListGoalsQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Invalid goal filters" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "viewGoals",
    );
    if (!membership) {
      return;
    }

    const filters: Record<string, unknown> = {
      workspaceId,
      deletedAt: null,
    };
    if (query.data.period) {
      filters.period = query.data.period;
    }
    if (query.data.status) {
      filters.status = query.data.status;
    }
    if (query.data.priority) {
      filters.priority = query.data.priority;
    }
    if (query.data.search) {
      filters.$or = [
        { title: { $regex: query.data.search, $options: "i" } },
        { description: { $regex: query.data.search, $options: "i" } },
      ];
    }
    const page = query.data.page ?? 1;
    const limit = 20;
    const [goals, total] = await Promise.all([
      GoalModel.find(filters)
        .sort({ deadline: 1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      GoalModel.countDocuments(filters),
    ]);
    const items = await Promise.all(
      goals.map(async (goal) =>
        serializeGoal(goal, await goalNames(goal)),
      ),
    );
    res.json(ListGoalsResponse.parse({ items, page, total }));
  },
);

router.post(
  "/workspaces/:workspaceId/goals",
  async (req, res): Promise<void> => {
    const workspaceId = asString(req.params.workspaceId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "createGoals",
    );
    if (!membership) {
      return;
    }
    const parsed = CreateGoalBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
      return;
    }
    const assigneeIds = parsed.data.assigneeIds ?? [];
    if (
      !can(membership, "assignGoals") &&
      assigneeIds.some((id) => id !== membership.userId.toString())
    ) {
      denied(res);
      return;
    }
    if (assigneeIds.some((id) => !validId(id))) {
      res.status(400).json({ error: "One or more assignees are invalid" });
      return;
    }
    if (assigneeIds.length) {
      const validAssignments = await MembershipModel.countDocuments({
        workspaceId,
        userId: { $in: assigneeIds },
        status: "active",
      });
      if (validAssignments !== new Set(assigneeIds).size) {
        res.status(400).json({ error: "Goals can only be assigned to workspace members" });
        return;
      }
    }

    const session = await mongoose.startSession();
    let goal: HydratedDocument<GoalShape> | undefined;
    try {
      await session.withTransaction(async () => {
        const created = new GoalModel({
          workspaceId: objectId(workspaceId),
          title: parsed.data.title.trim(),
          description: parsed.data.description ?? "",
          period: parsed.data.period,
          startDate: parsed.data.startDate
            ? new Date(parsed.data.startDate)
            : null,
          deadline: parsed.data.deadline
            ? new Date(parsed.data.deadline)
            : null,
          priority: parsed.data.priority ?? "medium",
          status: parsed.data.status ?? "not-started",
          progress: parsed.data.progress ?? 0,
          creatorId: membership.userId,
          assignees: assigneeIds.map(objectId),
          lastEditorId: membership.userId,
          version: 1,
        });
        await created.save({ session });
        const initialChanges = [
          fieldChange("title", null, created.title),
          fieldChange("description", null, created.description),
          fieldChange("period", null, created.period),
          fieldChange("startDate", null, created.startDate),
          fieldChange("deadline", null, created.deadline),
          fieldChange("priority", null, created.priority),
          fieldChange("status", null, created.status),
          fieldChange("assignees", null, assigneeIds),
        ];
        await writeActivity({
          workspaceId: objectId(workspaceId),
          actorId: membership.userId,
          goalId: created._id,
          goalTitle: created.title,
          action: "goal.created",
          changes: initialChanges,
          session,
        });
        goal = created;
      });
    } finally {
      await session.endSession();
    }
    if (!goal) {
      res.status(500).json({ error: "Goal could not be created" });
      return;
    }
    const output = serializeGoal(goal, await goalNames(goal));
    res.status(201).json(CreateGoalResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "goal:created", output);
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: "goal.created",
      goalId: output.id,
      goalTitle: output.title,
      createdAt: new Date().toISOString(),
    });
  },
);

router.get(
  "/workspaces/:workspaceId/goals/:goalId",
  async (req, res): Promise<void> => {
    const params = GetGoalParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid goal ID" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const goalId = asString(params.data.goalId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "viewGoals",
    );
    if (!membership) {
      return;
    }
    const goal = await GoalModel.findOne({
      _id: goalId,
      workspaceId,
      deletedAt: null,
    }).lean();
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    res.json(
      GetGoalResponse.parse(
        serializeGoal(goal, await goalNames(goal)),
      ),
    );
  },
);

router.patch(
  "/workspaces/:workspaceId/goals/:goalId",
  async (req, res): Promise<void> => {
    const params = UpdateGoalParams.safeParse(req.params);
    const parsed = UpdateGoalBody.safeParse(req.body);
    if (!params.success || !parsed.success) {
      res.status(400).json({ error: "Invalid goal update" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const goalId = asString(params.data.goalId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
      "viewGoals",
    );
    if (!membership) {
      return;
    }
    if (parsed.data.expectedVersion === undefined) {
      res.status(400).json({ error: "expectedVersion is required to prevent conflicting edits" });
      return;
    }

    const existing = await GoalModel.findOne({
      _id: goalId,
      workspaceId,
      deletedAt: null,
    });
    if (!existing) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    const actorId = membership.userId.toString();
    const ownsGoal = existing.creatorId.toString() === actorId;
    const fields = Object.keys(parsed.data).filter(
      (field) => field !== "expectedVersion",
    );
    if (fields.length === 0) {
      res.status(400).json({ error: "Provide at least one field to update" });
      return;
    }
    const statusOnly = fields.every(
      (field) => field === "status" || field === "progress",
    );
    if (statusOnly) {
      if (!can(membership, "changeGoalStatus")) {
        denied(res);
        return;
      }
    } else if (
      !can(membership, "editAnyGoals") &&
      !(ownsGoal && can(membership, "editOwnGoals"))
    ) {
      denied(res);
      return;
    }
    if (
      parsed.data.assigneeIds !== undefined &&
      !can(membership, "assignGoals")
    ) {
      denied(res);
      return;
    }
    const nextAssigneeIds = parsed.data.assigneeIds;
    if (nextAssigneeIds?.some((id) => !validId(id))) {
      res.status(400).json({ error: "One or more assignees are invalid" });
      return;
    }
    if (nextAssigneeIds?.length) {
      const validAssignments = await MembershipModel.countDocuments({
        workspaceId,
        userId: { $in: nextAssigneeIds },
        status: "active",
      });
      if (validAssignments !== new Set(nextAssigneeIds).size) {
        res.status(400).json({ error: "Goals can only be assigned to workspace members" });
        return;
      }
    }

    const update: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) update.title = parsed.data.title.trim();
    if (parsed.data.description !== undefined) update.description = parsed.data.description;
    if (parsed.data.period !== undefined) update.period = parsed.data.period;
    if (parsed.data.startDate !== undefined) {
      update.startDate = parsed.data.startDate ? new Date(parsed.data.startDate) : null;
    }
    if (parsed.data.deadline !== undefined) {
      update.deadline = parsed.data.deadline ? new Date(parsed.data.deadline) : null;
    }
    if (parsed.data.priority !== undefined) update.priority = parsed.data.priority;
    if (parsed.data.status !== undefined) update.status = parsed.data.status;
    if (parsed.data.progress !== undefined) update.progress = parsed.data.progress;
    if (parsed.data.assigneeIds !== undefined) {
      update.assignees = nextAssigneeIds?.map(objectId) ?? [];
    }
    if (parsed.data.status === "completed") {
      update.progress = 100;
    } else if (
      parsed.data.status !== undefined &&
      existing.progress === 100 &&
      parsed.data.progress === undefined
    ) {
      update.progress = 0;
    }

    const changes = Object.entries(update)
      .filter(([field, value]) => {
        const previous = field === "assignees" ? existing.assignees : existing.get(field);
        if (Array.isArray(value) && Array.isArray(previous)) {
          return value.map(String).join(",") !== previous.map(String).join(",");
        }
        return String(value ?? "") !== String(previous ?? "");
      })
      .map(([field, value]) => {
        const previous =
          field === "assignees"
            ? existing.assignees.map((id: Types.ObjectId) => id.toString())
            : existing.get(field);
        const next = Array.isArray(value) ? value.map(String) : value;
        return fieldChange(field, previous, next);
      });
    if (changes.length === 0) {
      res.json(
        UpdateGoalResponse.parse(
          serializeGoal(existing, await goalNames(existing)),
        ),
      );
      return;
    }

    const session = await mongoose.startSession();
    let updated: HydratedDocument<GoalShape> | null = null;
    let completionNotice: {
      text: string;
      createdAt: Date;
    } | null = null;
    try {
      updated = await session.withTransaction(async () => {
        const savedGoal = await GoalModel.findOneAndUpdate(
          {
            _id: goalId,
            workspaceId,
            version: parsed.data.expectedVersion,
            deletedAt: null,
          },
          {
            $set: { ...update, lastEditorId: membership.userId },
            $inc: { version: 1 },
          },
          { new: true, session },
        );
        if (!savedGoal) {
          throw new Error("GOAL_VERSION_CONFLICT");
        }
        const previousStatus = existing.status;
        const currentStatus = savedGoal.status;
        const action =
          previousStatus !== "completed" && currentStatus === "completed"
            ? "goal.completed"
            : previousStatus === "completed" && currentStatus !== "completed"
              ? "goal.reopened"
              : "goal.updated";
        if (action === "goal.completed") {
          const user = await UserModel.findById(membership.userId)
            .select("name")
            .session(session)
            .lean();
          const notice = new MessageModel({
            workspaceId: objectId(workspaceId),
            senderId: membership.userId,
            kind: "system",
            text: `${user?.name ?? "A team member"} completed “${savedGoal.title}”`,
            replyToId: null,
            editedAt: null,
            deletedAt: null,
          });
          await notice.save({ session });
          completionNotice = {
            text: notice.text,
            createdAt: notice.createdAt ?? new Date(),
          };
        }
        await writeActivity({
          workspaceId: objectId(workspaceId),
          actorId: membership.userId,
          goalId: objectId(goalId),
          goalTitle: savedGoal.title,
          action,
          changes,
          session,
        });
        return savedGoal;
      });
    } catch (error) {
      if (error instanceof Error && error.message === "GOAL_VERSION_CONFLICT") {
        res.status(409).json({ error: "This goal changed elsewhere. Refresh and try again." });
        return;
      }
      throw error;
    } finally {
      await session.endSession();
    }
    if (!updated) {
      res.status(409).json({ error: "This goal changed elsewhere. Refresh and try again." });
      return;
    }
    const saved = updated;
    const output = serializeGoal(saved, await goalNames(saved));
    const previousStatus = existing.status;
    const action =
      previousStatus !== "completed" && saved.status === "completed"
        ? "goal.completed"
        : previousStatus === "completed" && saved.status !== "completed"
          ? "goal.reopened"
          : "goal.updated";
    res.json(UpdateGoalResponse.parse(output));
    emitWorkspaceEvent(workspaceId, "goal:updated", output);
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action,
      goalId,
      goalTitle: saved.title,
      createdAt: new Date().toISOString(),
    });
    if (completionNotice) {
      emitWorkspaceEvent(workspaceId, "chat:new", {
        id: new Types.ObjectId().toString(),
        workspaceId,
        senderId: "system",
        senderName: "GoalSpace",
        senderAvatar: null,
        text: completionNotice.text,
        replyToId: null,
        createdAt: completionNotice.createdAt.toISOString(),
        editedAt: null,
        deleted: false,
      });
    }
  },
);

router.delete(
  "/workspaces/:workspaceId/goals/:goalId",
  async (req, res): Promise<void> => {
    const params = DeleteGoalParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid goal ID" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const goalId = asString(params.data.goalId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
    );
    if (!membership) {
      return;
    }
    const goal = await GoalModel.findOne({
      _id: goalId,
      workspaceId,
      deletedAt: null,
    });
    if (!goal) {
      res.status(404).json({ error: "Goal not found" });
      return;
    }
    const ownsGoal = goal.creatorId.toString() === membership.userId.toString();
    if (
      !can(membership, "deleteAnyGoals") &&
      !(ownsGoal && can(membership, "deleteOwnGoals"))
    ) {
      denied(res);
      return;
    }
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        const changed = await GoalModel.updateOne(
          {
            _id: goalId,
            workspaceId,
            version: goal.version,
            deletedAt: null,
          },
          {
            $set: { deletedAt: new Date(), lastEditorId: membership.userId },
            $inc: { version: 1 },
          },
          { session },
        );
        if (!changed.modifiedCount) {
          throw new Error("GOAL_VERSION_CONFLICT");
        }
        await writeActivity({
          workspaceId: objectId(workspaceId),
          actorId: membership.userId,
          goalId: objectId(goalId),
          goalTitle: goal.title,
          action: "goal.deleted",
          changes: [fieldChange("deleted", false, true)],
          session,
        });
      });
    } catch (error) {
      if (error instanceof Error && error.message === "GOAL_VERSION_CONFLICT") {
        res.status(409).json({ error: "This goal changed elsewhere. Refresh and try again." });
        return;
      }
      throw error;
    } finally {
      await session.endSession();
    }
    res.json(DeleteGoalResponse.parse({ success: true }));
    emitWorkspaceEvent(workspaceId, "goal:deleted", { goalId });
    emitWorkspaceEvent(workspaceId, "activity:new", {
      action: "goal.deleted",
      goalId,
      goalTitle: goal.title,
      createdAt: new Date().toISOString(),
    });
  },
);

router.get(
  "/workspaces/:workspaceId/goals/:goalId/history",
  async (req, res): Promise<void> => {
    const params = GetGoalHistoryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid goal ID" });
      return;
    }
    const workspaceId = asString(params.data.workspaceId);
    const goalId = asString(params.data.goalId);
    const membership = await requireWorkspace(
      req.session.userId,
      workspaceId,
      res,
    );
    if (!membership) {
      return;
    }
    const entries = await ActivityLogModel.find({
      workspaceId,
      goalId,
    })
      .sort({ createdAt: -1 })
      .populate("actorId", "name avatar")
      .lean();
    const output = entries.map((entry) => {
      const actor = entry.actorId as unknown as {
        _id: Types.ObjectId;
        name: string;
        avatar: string | null;
      };
      return serializeActivity(entry, actor);
    });
    res.json(GetGoalHistoryResponse.parse(output));
  },
);

router.get(
  "/workspaces/:workspaceId/activity",
  async (req, res): Promise<void> => {
    const params = ListActivityParams.safeParse(req.params);
    const query = ListActivityQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Invalid activity filters" });
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
    const filter: Record<string, unknown> = { workspaceId };
    if (query.data.memberId && validId(query.data.memberId)) {
      filter.actorId = query.data.memberId;
    }
    if (query.data.action) {
      filter.action = query.data.action;
    }
    if (query.data.goalId && validId(query.data.goalId)) {
      filter.goalId = query.data.goalId;
    }
    if (query.data.from || query.data.to) {
      const createdAt: Record<string, Date> = {};
      if (query.data.from) {
        createdAt.$gte = new Date(`${query.data.from}T00:00:00.000Z`);
      }
      if (query.data.to) {
        createdAt.$lte = new Date(`${query.data.to}T23:59:59.999Z`);
      }
      filter.createdAt = createdAt;
    }
    const page = query.data.page ?? 1;
    const limit = 20;
    const [entries, total] = await Promise.all([
      ActivityLogModel.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("actorId", "name avatar")
        .lean(),
      ActivityLogModel.countDocuments(filter),
    ]);
    const output = entries.map((entry) => {
      const actor = entry.actorId as unknown as {
        _id: Types.ObjectId;
        name: string;
        avatar: string | null;
      };
      return serializeActivity(entry, actor);
    });
    res.json(ListActivityResponse.parse({ items: output, page, total }));
  },
);

export default router;

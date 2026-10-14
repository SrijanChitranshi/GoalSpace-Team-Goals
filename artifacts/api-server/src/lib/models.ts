import mongoose, { Schema, Types } from "mongoose";

export const permissionKeys = [
  "viewGoals",
  "createGoals",
  "editOwnGoals",
  "editAnyGoals",
  "deleteOwnGoals",
  "deleteAnyGoals",
  "assignGoals",
  "changeGoalStatus",
  "sendMessages",
  "editOwnMessages",
  "deleteOwnMessages",
  "moderateChat",
  "inviteMembers",
  "approveJoinRequests",
  "manageMemberPermissions",
] as const;

export type PermissionKey = (typeof permissionKeys)[number];
export type PermissionSet = Record<PermissionKey, boolean>;

export const defaultMemberPermissions: PermissionSet = {
  viewGoals: true,
  createGoals: true,
  editOwnGoals: true,
  editAnyGoals: false,
  deleteOwnGoals: true,
  deleteAnyGoals: false,
  assignGoals: false,
  changeGoalStatus: true,
  sendMessages: true,
  editOwnMessages: true,
  deleteOwnMessages: true,
  moderateChat: false,
  inviteMembers: false,
  approveJoinRequests: false,
  manageMemberPermissions: false,
};

export const defaultAdminPermissions: PermissionSet = {
  viewGoals: true,
  createGoals: true,
  editOwnGoals: true,
  editAnyGoals: true,
  deleteOwnGoals: true,
  deleteAnyGoals: true,
  assignGoals: true,
  changeGoalStatus: true,
  sendMessages: true,
  editOwnMessages: true,
  deleteOwnMessages: true,
  moderateChat: true,
  inviteMembers: true,
  approveJoinRequests: true,
  manageMemberPermissions: false,
};

export const allPermissions: PermissionSet = Object.fromEntries(
  permissionKeys.map((key) => [key, true]),
) as PermissionSet;

export type UserShape = {
  name: string;
  email: string;
  passwordHash: string;
  avatar: string | null;
};

const userSchema = new Schema<UserShape>(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    passwordHash: { type: String, required: true, select: false },
    avatar: { type: String, default: null },
  },
  { timestamps: true },
);

export const UserModel =
  mongoose.models.GoalSpaceUser ??
  mongoose.model<UserShape>("GoalSpaceUser", userSchema);

export type WorkspaceShape = {
  name: string;
  workspaceCode: string;
  ownerId: Types.ObjectId;
  approvalRequired: boolean;
};

const workspaceSchema = new Schema<WorkspaceShape>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    workspaceCode: { type: String, required: true, unique: true, index: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, ref: "GoalSpaceUser" },
    approvalRequired: { type: Boolean, default: false },
  },
  { timestamps: true },
);

export const WorkspaceModel =
  mongoose.models.GoalSpaceWorkspace ??
  mongoose.model<WorkspaceShape>("GoalSpaceWorkspace", workspaceSchema);

export type MembershipShape = {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  role: "owner" | "admin" | "member";
  permissions: PermissionSet;
  permissionCeiling: PermissionSet;
  status: "active" | "removed";
  joinedAt: Date;
};

const permissionSchema = new Schema<PermissionSet>(
  Object.fromEntries(
    permissionKeys.map((key) => [key, { type: Boolean, default: false }]),
  ),
  { _id: false },
);

const membershipSchema = new Schema<MembershipShape>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceWorkspace",
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceUser",
    },
    role: { type: String, enum: ["owner", "admin", "member"], required: true },
    permissions: { type: permissionSchema, required: true },
    permissionCeiling: { type: permissionSchema, required: true },
    status: { type: String, enum: ["active", "removed"], default: "active" },
    joinedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

membershipSchema.index({ workspaceId: 1, userId: 1 }, { unique: true });
membershipSchema.index({ workspaceId: 1, status: 1 });

export const MembershipModel =
  mongoose.models.GoalSpaceMembership ??
  mongoose.model<MembershipShape>("GoalSpaceMembership", membershipSchema);

export type InvitationShape = {
  workspaceId: Types.ObjectId;
  secretHash: string;
  creatorId: Types.ObjectId;
  expiresAt: Date;
  usageLimit: number | null;
  usageCount: number;
  revokedAt: Date | null;
};

const invitationSchema = new Schema<InvitationShape>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceWorkspace",
      index: true,
    },
    secretHash: { type: String, required: true, unique: true },
    creatorId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceUser",
    },
    expiresAt: { type: Date, required: true, index: true },
    usageLimit: { type: Number, default: null },
    usageCount: { type: Number, default: 0 },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const InvitationModel =
  mongoose.models.GoalSpaceInvitation ??
  mongoose.model<InvitationShape>("GoalSpaceInvitation", invitationSchema);

export type JoinRequestShape = {
  workspaceId: Types.ObjectId;
  userId: Types.ObjectId;
  status: "pending" | "approved" | "rejected";
};

const joinRequestSchema = new Schema<JoinRequestShape>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceWorkspace",
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceUser",
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

joinRequestSchema.index(
  { workspaceId: 1, userId: 1 },
  { unique: true },
);

export const JoinRequestModel =
  mongoose.models.GoalSpaceJoinRequest ??
  mongoose.model<JoinRequestShape>("GoalSpaceJoinRequest", joinRequestSchema);

export type GoalShape = {
  workspaceId: Types.ObjectId;
  title: string;
  description: string;
  period: "daily" | "weekly" | "monthly";
  startDate: Date | null;
  deadline: Date | null;
  priority: "low" | "medium" | "high";
  status: "not-started" | "in-progress" | "blocked" | "completed";
  progress: number;
  creatorId: Types.ObjectId;
  assignees: Types.ObjectId[];
  lastEditorId: Types.ObjectId | null;
  version: number;
  deletedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

const goalSchema = new Schema<GoalShape>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceWorkspace",
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, default: "", maxlength: 5000 },
    period: {
      type: String,
      enum: ["daily", "weekly", "monthly"],
      required: true,
      index: true,
    },
    startDate: { type: Date, default: null },
    deadline: { type: Date, default: null, index: true },
    priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
    status: {
      type: String,
      enum: ["not-started", "in-progress", "blocked", "completed"],
      default: "not-started",
      index: true,
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    creatorId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceUser",
      index: true,
    },
    assignees: [{ type: Schema.Types.ObjectId, ref: "GoalSpaceUser" }],
    lastEditorId: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "GoalSpaceUser",
    },
    version: { type: Number, default: 1 },
    deletedAt: { type: Date, default: null, index: true },
  },
  { timestamps: true },
);

goalSchema.index({
  workspaceId: 1,
  deletedAt: 1,
  period: 1,
  deadline: 1,
});

export const GoalModel =
  mongoose.models.GoalSpaceGoal ??
  mongoose.model<GoalShape>("GoalSpaceGoal", goalSchema);

export type MessageShape = {
  workspaceId: Types.ObjectId;
  senderId: Types.ObjectId;
  kind: "user" | "system";
  text: string;
  replyToId: Types.ObjectId | null;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
};

const messageSchema = new Schema<MessageShape>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceWorkspace",
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceUser",
      index: true,
    },
    kind: { type: String, enum: ["user", "system"], default: "user" },
    text: { type: String, required: true, maxlength: 4000 },
    replyToId: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "GoalSpaceMessage",
    },
    editedAt: { type: Date, default: null },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

messageSchema.index({ workspaceId: 1, createdAt: -1 });

export const MessageModel =
  mongoose.models.GoalSpaceMessage ??
  mongoose.model<MessageShape>("GoalSpaceMessage", messageSchema);

export type FieldChangeShape = {
  field: string;
  previousValue: string | null;
  newValue: string | null;
};

export type ActivityLogShape = {
  workspaceId: Types.ObjectId;
  goalId: Types.ObjectId | null;
  goalTitle: string | null;
  actorId: Types.ObjectId;
  action: string;
  changes: FieldChangeShape[];
  metadata: Record<string, string>;
};

const fieldChangeSchema = new Schema<FieldChangeShape>(
  {
    field: { type: String, required: true },
    previousValue: { type: String, default: null },
    newValue: { type: String, default: null },
  },
  { _id: false },
);

const activityLogSchema = new Schema<ActivityLogShape>(
  {
    workspaceId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceWorkspace",
      index: true,
    },
    goalId: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "GoalSpaceGoal",
      index: true,
    },
    goalTitle: { type: String, default: null },
    actorId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "GoalSpaceUser",
      index: true,
    },
    action: { type: String, required: true, index: true },
    changes: { type: [fieldChangeSchema], default: [] },
    metadata: { type: Map, of: String, default: {} },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

activityLogSchema.index({ workspaceId: 1, createdAt: -1 });
activityLogSchema.index({ workspaceId: 1, goalId: 1, createdAt: -1 });

export const ActivityLogModel =
  mongoose.models.GoalSpaceActivityLog ??
  mongoose.model<ActivityLogShape>("GoalSpaceActivityLog", activityLogSchema);

import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import {
  invitationJoinRouter,
  workspaceRouter,
} from "./workspaces";
import goalsRouter from "./goals";
import chatRouter from "./chat";

const router: IRouter = Router();

router.use(healthRouter);
router.use("/v1/auth", authRouter);
router.use("/v1/invitations", invitationJoinRouter);
router.use("/v1/workspaces", workspaceRouter);
router.use("/v1", goalsRouter);
router.use("/v1", chatRouter);

export default router;

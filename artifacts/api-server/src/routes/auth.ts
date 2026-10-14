import { Router, type IRouter, type Request } from "express";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  RegisterBody,
  RegisterResponse,
} from "@workspace/api-zod";
import { UserModel } from "../lib/models";
import { hashPassword, verifyPassword } from "../lib/passwords";
import { serializeUser } from "../lib/goalspace";

const router: IRouter = Router();

function saveSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.save((error) => (error ? reject(error) : resolve()));
  });
}

function regenerateSession(req: Request) {
  return new Promise<void>((resolve, reject) => {
    req.session.regenerate((error) => (error ? reject(error) : resolve()));
  });
}

router.post("/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  const existing = await UserModel.exists({ email });
  if (existing) {
    res.status(409).json({ error: "An account with this email already exists" });
    return;
  }

  const user = await UserModel.create({
    name: parsed.data.name.trim(),
    email,
    passwordHash: await hashPassword(parsed.data.password),
    avatar: null,
  });

  await regenerateSession(req);
  req.session.userId = user._id.toString();
  await saveSession(req);
  res.status(201).json(RegisterResponse.parse({ user: serializeUser(user) }));
});

router.post("/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }

  const user = await UserModel.findOne({
    email: parsed.data.email.trim().toLowerCase(),
  }).select("+passwordHash");
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    res.status(401).json({ error: "Email or password is incorrect" });
    return;
  }

  await regenerateSession(req);
  req.session.userId = user._id.toString();
  await saveSession(req);
  res.json(LoginResponse.parse({ user: serializeUser(user) }));
});

router.post("/logout", async (req, res): Promise<void> => {
  if (req.session) {
    await new Promise<void>((resolve, reject) => {
      req.session.destroy((error) => (error ? reject(error) : resolve()));
    });
  }
  res.clearCookie("goalspace.sid", { path: "/" });
  res.json(LogoutResponse.parse({ success: true }));
});

router.get("/me", async (req, res): Promise<void> => {
  if (!req.session.userId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const user = await UserModel.findById(req.session.userId);
  if (!user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  res.json(GetCurrentUserResponse.parse({ user: serializeUser(user) }));
});

export default router;

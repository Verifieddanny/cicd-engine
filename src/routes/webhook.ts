import { Router } from "express";
import { createProject } from "../controller/project.js";

const WebhookRouter = Router();

WebhookRouter.get("/", () => {});

export default WebhookRouter;

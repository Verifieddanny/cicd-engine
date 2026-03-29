import { Router } from "express";
import { createProject, handleWebhook } from "../controller/project.js";

const WebhookRouter = Router();

WebhookRouter.post("/", handleWebhook);

export default WebhookRouter;

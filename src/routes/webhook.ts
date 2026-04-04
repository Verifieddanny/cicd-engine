import { Router } from "express";
import { handleWebhook } from "../controller/project.js";

const WebhookRouter = Router();

WebhookRouter.post("/", handleWebhook);

export default WebhookRouter;

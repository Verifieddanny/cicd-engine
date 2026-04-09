import { Router } from "express";
import { getBuild, rebuild } from "../controller/builds.js";

const BuildRouter = Router();

BuildRouter.post("/rebuild/:buildId", rebuild);
BuildRouter.get("/:buildId", getBuild);


export default BuildRouter;

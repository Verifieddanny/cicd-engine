
import { Router } from "express";
import { getDeployment, rollBack } from "../controller/deployment.js";

const DeploymentRouter = Router();
DeploymentRouter.get("/deployments/:deploymentId", getDeployment);
DeploymentRouter.put("/rollback", rollBack);

export default DeploymentRouter;
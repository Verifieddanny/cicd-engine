import { Router } from "express";
import { projectCreationValidation, projectUpdateValidation } from "../validation/project.js";
import {
  createProject,
  deleteProject,
  getBuild,
  getDeployment,
  getProjects,
  rebuild,
  updateProject,
} from "../controller/project.js";
import { fetchOrganization, fetchRepos } from "../controller/repos.js";

const ProjectRouter = Router();

ProjectRouter.post("/", projectCreationValidation, createProject);
ProjectRouter.get("/orgs", fetchOrganization);
ProjectRouter.get("/repos", fetchRepos);
ProjectRouter.get("/projects", getProjects);
ProjectRouter.put(
  "/projects/:projectId",

  projectUpdateValidation,
  updateProject,
);
ProjectRouter.delete("/projects/:projectId", deleteProject);
ProjectRouter.post("/rebuild/:buildId", rebuild);
ProjectRouter.get("/deployments/:deploymentId", getDeployment);
ProjectRouter.get("/builds/:buildId", getBuild);

export default ProjectRouter;

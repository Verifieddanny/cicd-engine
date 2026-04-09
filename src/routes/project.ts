import { Router } from "express";
import { projectCreationValidation, projectUpdateValidation } from "../validation/project.js";
import {
  createProject,
  deleteProject,
  deleteSecret,
  getProjects,
  updateProject,
} from "../controller/project.js";

const ProjectRouter = Router();

ProjectRouter.post("/", projectCreationValidation, createProject);
ProjectRouter.get("/projects", getProjects);
ProjectRouter.put("/projects/:projectId", projectUpdateValidation, updateProject);
ProjectRouter.delete("/projects/:projectId", deleteProject);
ProjectRouter.delete("/secret/:secretId", deleteSecret);

export default ProjectRouter;

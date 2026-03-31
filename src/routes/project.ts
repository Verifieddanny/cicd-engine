import { Router } from "express";
import { projectCreationValidation } from "../validation/project.js";
import { createProject } from "../controller/project.js";
import { isAuth } from "../middleware/is-auth.js";
import { fetchOrganization, fetchRepos } from "../controller/repos.js";

const ProjectRouter = Router();

ProjectRouter.post("/", projectCreationValidation, createProject);
ProjectRouter.get("/orgs", isAuth, fetchOrganization);
ProjectRouter.get("/repos", isAuth, fetchRepos);

export default ProjectRouter;

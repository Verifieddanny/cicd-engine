import { Router } from "express";
import { projectCreationValidation } from "../validation/project.js";
import { createProject } from "../controller/project.js";

const ProjectRouter = Router()


ProjectRouter.post("/", projectCreationValidation, createProject)


export default ProjectRouter;
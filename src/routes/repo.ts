import { Router } from "express";
import { fetchOrganization, fetchRepos } from "../controller/repos.js";


const RepoRouter = Router();

RepoRouter.get("/orgs", fetchOrganization);
RepoRouter.get("/repos", fetchRepos);
export default RepoRouter;
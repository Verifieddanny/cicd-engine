import { Router } from "express";
import { handleCallback, redirectToGithub } from "../controller/auth.js";


let AuthRouter = Router();


AuthRouter.get("/github", redirectToGithub);

AuthRouter.get("/github/callback", handleCallback);


export default AuthRouter;
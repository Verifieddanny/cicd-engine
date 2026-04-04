import { Router } from "express";
import { isAuth } from "../middleware/is-auth.js";
import { profileUpdateValidation } from "../validation/user.js";
import { updateProfile } from "../controller/user.js";

const UserRouter = Router();

UserRouter.get("/profile", profileUpdateValidation, updateProfile);

export default UserRouter;

import { body } from "express-validator";

export const projectCreationValidation = [
  body("name").notEmpty().trim(),
  body("branch").notEmpty().trim(),
  body("buildCommand").notEmpty().trim(),
  body("repoUrl").isURL(),

  body("secrets").optional().isArray(),
  body("secrets.*.key").notEmpty().withMessage("Secret key is required"),
  body("secrets.*.value").notEmpty().withMessage("Secret value is required"),
];

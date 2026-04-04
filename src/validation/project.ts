import { body } from "express-validator";
import { db } from "../db/index.js";
import { projectTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const projectCreationValidation = [
  body("name")
    .notEmpty()
    .trim()
    .custom(async (value, { req }) => {
      return db
        .select()
        .from(projectTable)
        .where(eq(projectTable.name, value))
        .then((project) => {
          if (project.length > 0) {
            return Promise.reject("Project name already exists");
          }
        });
    }),
  body("branch").notEmpty().trim(),
  body("buildCommand").optional().notEmpty().trim(),
  body("installCommand").optional().notEmpty().trim(),
  body("repoUrl").isURL(),

  body("secrets").optional().isArray(),
  body("secrets.*.key").notEmpty().withMessage("Secret key is required"),
  body("secrets.*.value").notEmpty().withMessage("Secret value is required"),
];

export const projectUpdateValidation = [
  body("name")
    .optional()
    .notEmpty()
    .trim()
    .custom(async (value, { req }) => {
      return db
        .select()
        .from(projectTable)
        .where(eq(projectTable.name, value))
        .then((project) => {
          if (project.length > 0) {
            return Promise.reject("Project name already exists");
          }
        });
    }),
  body("branch").optional().notEmpty().trim(),
  body("buildCommand").optional().notEmpty().trim(),
  body("installCommand").optional().notEmpty().trim(),
  body("repoUrl").optional().isURL(),

  body("secrets").optional().isArray(),
  body("secrets.*.key").notEmpty().withMessage("Secret key is required"),
  body("secrets.*.value").notEmpty().withMessage("Secret value is required"),
];

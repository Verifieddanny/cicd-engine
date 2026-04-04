import { body } from "express-validator";
import { db } from "../db/index.js";
import { userTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const profileUpdateValidation = [
  body("username")
    .notEmpty()
    .trim()
    .custom(async (value, { req }) => {
      return db
        .select()
        .from(userTable)
        .where(eq(userTable.username, value))
        .then((users) => {
          if (users.length > 0) {
            const existingUser = users[0];
            if (existingUser?.id !== req.userId) {
              return Promise.reject("Username already exists");
            }
          }
        });
    }),
  body("email")
    .notEmpty()
    .trim()
    .isEmail()
    .withMessage("Invalid email address"),
];

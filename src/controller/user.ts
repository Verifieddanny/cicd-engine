import type { NextFunction, Response } from "express";
import type { AuthRequest, CustomError } from "../shared/types.js";
import { db } from "../db/index.js";
import { userTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const updateProfile = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;
    const username = req.body.username as string;
    const email = req.body.email as string;

    if (!userId) {
      const error: CustomError = new Error("User not authenticated");
      error.statusCode = 401;
      throw error;
    }

    await db
      .update(userTable)
      .set({ username, email })
      .where(eq(userTable.id, Number(userId)));

    res.status(200).json({ message: "Profile updated successfully" });
  } catch (err) {
    const error = err as CustomError;
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

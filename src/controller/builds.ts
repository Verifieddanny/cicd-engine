import type { NextFunction, Response } from "express";
import type { AuthRequest, CustomError } from "../shared/types.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { buildTable } from "../db/schema.js";
import * as buildService from "../services/buildEngine.js";


export const rebuild = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.userId;
        const buildId = req.params.buildId;

        if (!buildId) {
            const error: CustomError = new Error("Build ID is required");
            error.statusCode = 400;
            throw error;
        }

        if (!userId) {
            const error: CustomError = new Error("User ID is required");
            error.statusCode = 400;
            throw error;
        }

        const build = await db.query.buildTable.findFirst({
            where: eq(buildTable.id, Number(buildId)),
            with: {
                project: {
                    with: {
                        user: true,
                        secrets: true,
                    },
                },
            },
        });

        if (!build) {
            const error: CustomError = new Error("Build not found");
            error.statusCode = 404;
            throw error;
        }

        if (build.project.userId !== Number(userId)) {
            const error: CustomError = new Error("Unauthorized");
            error.statusCode = 403;
            throw error;
        }

        const [newBuild] = await db
            .insert(buildTable)
            .values({
                commit: build.commit,
                branch: build.branch,
                commitAuthor: build.commitAuthor,
                commitHash: build.commitHash,
                projectId: build.projectId,
            })
            .returning();

        if (!newBuild) {
            const error: CustomError = new Error("Failed to create new build");
            error.statusCode = 500;
            throw error;
        }

        res.status(200).json({
            message: "Build re-queued",
            build: newBuild,
        });

        await buildService.runBuild(
            build.project,
            build.project.repoUrl,
            build.branch,
            newBuild,
            req.app.get("io"),
            next,
        );
    } catch (err) {
        const error = err as CustomError;

        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};


export const getBuild = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;
    const buildId = req.params.buildId;

    if (!buildId) {
      const error: CustomError = new Error("Build ID is required");
      error.statusCode = 400;
      throw error;
    }

    if (!userId) {
      const error: CustomError = new Error("User ID is required");
      error.statusCode = 400;
      throw error;
    }
    const build = await db.query.buildTable.findFirst({
      where: eq(buildTable.id, Number(buildId)),
      with: {
        project: {
          with: {
            user: true,
          },
        },
      },
    });

    if (!build) {
      const error: CustomError = new Error("Build not found");
      error.statusCode = 404;
      throw error;
    }

    if (build.project.userId !== Number(userId)) {
      const error: CustomError = new Error("Unauthorized");
      error.statusCode = 403;
      throw error;
    }

    res.status(200).json({
      message: "Build fetched",
      build,
    });
  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
};

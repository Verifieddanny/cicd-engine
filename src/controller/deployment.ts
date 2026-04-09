import type { NextFunction, Response } from "express";
import type { AuthRequest, CustomError } from "../shared/types.js";
import { db } from "../db/index.js";
import { eq } from "drizzle-orm";
import { buildTable, deploymentTable } from "../db/schema.js";
import * as buildService from "../services/buildEngine.js";


export const getDeployment = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.userId;
        const deploymentId = req.params.deploymentId;

        if (!deploymentId) {
            const error: CustomError = new Error("Deployment ID is required");
            error.statusCode = 400;
            throw error;
        }

        if (!userId) {
            const error: CustomError = new Error("User ID is required");
            error.statusCode = 400;
            throw error;
        }

        const deployment = await db.query.deploymentTable.findFirst({
            where: eq(deploymentTable.id, Number(deploymentId)),
            with: {
                build: {
                    with: {
                        project: {
                            with: {
                                user: true,
                            },
                        },
                    },
                },
            },
        });

        if (!deployment) {
            const error: CustomError = new Error("Deployment not found");
            error.statusCode = 404;
            throw error;
        }

        if (deployment.build.project.userId !== Number(userId)) {
            const error: CustomError = new Error("Unauthorized");
            error.statusCode = 403;
            throw error;
        }

        res.status(200).json({
            message: "Deployment fetched",
            deployment,
        });
    } catch (err) {
        const error = err as CustomError;

        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
};






export const rollBack = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
) => {
    try {
        const userId = req.userId;
        const latestDeploymentId = req.query.latest;
        const prevDeploymentId = req.query.prev;

        if (!latestDeploymentId || !prevDeploymentId) {
            const error: CustomError = new Error("Deployment ID is required");
            error.statusCode = 400;
            throw error;
        }

        if (!userId) {
            const error: CustomError = new Error("User ID is required");
            error.statusCode = 400;
            throw error;
        }

        const prevDeployment = await db.query.deploymentTable.findFirst({
            where: eq(deploymentTable.id, Number(prevDeploymentId)),
            with: {
                build: {
                    with: {
                        project: {
                            with: {
                                secrets: true,
                                user: true
                            }
                        }
                    }
                }
            }
        })

        if (!prevDeployment) {
            const error: CustomError = new Error("Deployment not found");
            error.statusCode = 404;
            throw error;
        }

        if (prevDeployment?.build.project.userId !== Number(userId)) {
            const error: CustomError = new Error("Unauthorized");
            error.statusCode = 403;
            throw error;
        }

        const [newBuild] = await db
            .insert(buildTable)
            .values({
                commit: prevDeployment.build.commit,
                branch: prevDeployment.build.branch,
                commitAuthor: prevDeployment.build.commitAuthor,
                commitHash: prevDeployment.build.commitHash,
                projectId: prevDeployment.build.projectId,
            })
            .returning();

        if (!newBuild) {
            const error: CustomError = new Error("Failed to create new build");
            error.statusCode = 500;
            throw error;
        }

        await db.update(deploymentTable).set({ status: "rolled_back" }).where(eq(deploymentTable.id, Number(latestDeploymentId)))
        
        res.status(200).json({
            message: "Deployment rollback and re-queued",
            build: newBuild,
        });

        await buildService.runBuild(
            prevDeployment.build.project,
            prevDeployment.build.project.repoUrl,
            prevDeployment.build.branch,
            newBuild,
            req.app.get("io"),
            next,
            true
        );


    } catch (err) {
        const error = err as CustomError;

        if (!error.statusCode) {
            error.statusCode = 500;
        }

        next(error);
    }
}
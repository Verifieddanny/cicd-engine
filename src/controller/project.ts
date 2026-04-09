import type { DefaultEventsMap, Server } from "socket.io";
import type { NextFunction, Request, Response } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  GITHUB_API,
  type AuthRequest,
  type CustomError,
} from "../shared/types.js";
import { db } from "../db/index.js";
import {
  buildTable,
  projectTable,
  secretsTable,
  userTable,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { validationResult } from "express-validator";
import { encrypt } from "../lib/encryption.js";
import * as buildService from "../services/buildEngine.js";
import { fetchRepoCommit } from "../services/fetchProjectCommits.js";

export const createProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      const error: CustomError = new Error("Invalid inputs");
      error.statusCode = 422;
      error.data = errors.array();
      throw error;
    }

    const userId = req.userId;

    const result = await db
      .selectDistinct({
        accessToken: userTable.githubToken,
      })
      .from(userTable)
      .where(eq(userTable.id, Number(userId)))
      .limit(1);

    const user = result[0];

    if (!user) {
      const error: CustomError = new Error("User not found");
      error.statusCode = 400;
      throw error;
    }

    const projectName = req.body.name;
    const branch = req.body.branch;
    const buildCommand = req.body.buildCommand;
    const installCommand = req.body.installCommand;
    const repoUrl = req.body.repoUrl;
    const secrets = req.body.secrets || [];
    const io: Server<
      DefaultEventsMap,
      DefaultEventsMap,
      DefaultEventsMap,
      any
    > = req.app.get("io");

    const url = new URL(repoUrl);

    const pathParts = url.pathname.split("/").filter(Boolean);

    const repoName = pathParts[pathParts.length - 1];
    const owner = pathParts[0];

   
    const webhookResponse = await fetch(
      `${GITHUB_API}/repos/${owner}/${repoName}/hooks`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.accessToken}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2026-03-10",
        },
        body: JSON.stringify({
          name: "web",
          active: true,
          events: ["push", "pull_request"],
          config: {
            url: `${process.env.WEBHOOK_CALLBACK}/api/webhook`,
            content_type: "json",
            insecure_ssl: "0",
            secret: process.env.WEBHOOK_SECRET,
          },
        }),
      },
    );

    if (!webhookResponse.ok) {
      const error: CustomError = new Error("Failed to create GitHub webhook");
      error.statusCode = webhookResponse.status;
      throw error;
    }

    const webhook = await webhookResponse.json();

    const [newProject] = await db
      .insert(projectTable)
      .values({
        name: projectName,
        branch,
        buildCommand,
        installCommand,
        repoUrl,
        webhookId: webhook.id.toString(),
        userId: Number(userId),
      })
      .returning();

    if (!newProject) {
      const error: CustomError = new Error("Failed to create project");
      error.statusCode = 500;
      throw error;
    }

    const fullProjectData = {
      ...newProject,
      user: { githubToken: user.accessToken },
      secrets: []
    };

    if (secrets && secrets.length > 0) {
      const secretsToInsert = secrets.map(
        (s: { key: string; value: string }) => ({
          projectId: newProject.id,
          key: s.key,
          value: encrypt(s.value),
        }),
      );

      fullProjectData.secrets = secretsToInsert;

      await db.insert(secretsTable).values(secretsToInsert);
    }



    res.status(201).json({
      message: "project created",
      project: {
        ...newProject,
      },
    });



    await fetchRepoCommit(owner || "", repoName || "", branch, user.accessToken, fullProjectData, io, next);


  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
};

export const handleWebhook = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const signature = req.headers["x-hub-signature-256"] as string;
  if (!signature) {
    return res.status(401).json({ message: "No signature" });
  }

  const hmac = createHmac("sha256", process.env.WEBHOOK_SECRET!);
  const digest =
    "sha256=" + hmac.update(JSON.stringify(req.body)).digest("hex");

  const trusted = Buffer.from(digest);
  const received = Buffer.from(signature);

  if (!timingSafeEqual(trusted, received)) {
    return res.status(401).json({ message: "Invalid signature" });
  }

  try {
    const event = req.headers["x-github-event"];
    if (event === "ping") {
      return res.status(200).json({ message: "Github pinged" });
    }

    if (event === "push") {
      const io: Server<
        DefaultEventsMap,
        DefaultEventsMap,
        DefaultEventsMap,
        any
      > = req.app.get("io");
      const payload = req.body;
      const recentCommitMessage = payload.commits[0].message;
      const author = payload.commits[0].author.name;
      const branch = payload.ref.replace("refs/heads/", "");
      const repoUrl: string = payload.repository.html_url;
      const commitHash = payload.after;

      const project = await db.query.projectTable.findFirst({
        where: (table, { eq, and }) =>
          and(eq(table.repoUrl, repoUrl), eq(table.branch, branch)),
        with: {
          user: true,
          secrets: true,
        },
      });

      if (!project) {
        const error: CustomError = new Error("Project does not exist");
        error.statusCode = 404;
        throw error;
      }

      const [newBuild] = await db
        .insert(buildTable)
        .values({
          status: "queued",
          commit: recentCommitMessage,
          branch,
          commitAuthor: author,
          projectId: project.id,
          commitHash,
        })
        .returning();

      if (!newBuild) {
        const error: CustomError = new Error("Failed to save build");
        error.statusCode = 500;
        throw error;
      }

      res.status(201).json({
        message: "Build Queued",
        build: {
          ...newBuild,
        },
      });

      await buildService.runBuild(project, repoUrl, branch, newBuild, io, next);
    }
  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
};

export const getProjects = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;

    const projects = await db.query.projectTable.findMany({
      where: (table, { eq }) => eq(table.userId, Number(userId)),
      with: {
        secrets: true,
        builds: {
          orderBy: (buildTable, { desc }) => [desc(buildTable.startedAt)],
          with: {
            deployment: true,
            logs: true,
          },
        },
      },
    });

    if (!projects) {
      const error: CustomError = new Error("Failed to fetch projects");
      error.statusCode = 500;
      throw error;
    }

    res.status(200).json({
      message: "Projects fetched",
      projects,
    });
  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
};

export const updateProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;
    const projectId = req.params.projectId;
    const { name, branch, buildCommand, installCommand } = req.body;
    const secrets = req.body.secrets || [];

    if (!projectId) {
      const error: CustomError = new Error("Project ID is required");
      error.statusCode = 400;
      throw error;
    }

    const project = await db.query.projectTable.findFirst({
      where: eq(projectTable.id, Number(projectId)),
    });

    if (!project) {
      const error: CustomError = new Error("Project not found");
      error.statusCode = 404;
      throw error;
    }

    if (project.userId !== Number(userId)) {
      const error: CustomError = new Error("Unauthorized");
      error.statusCode = 403;
      throw error;
    }

    const updatedProject = await db
      .update(projectTable)
      .set({
        name: name || project.name,
        branch: branch || project.branch,
        buildCommand: buildCommand || project.buildCommand,
        installCommand: installCommand || project.installCommand,
        updatedAt: new Date(),
      })
      .where(eq(projectTable.id, Number(projectId)))
      .returning();

    if (!updatedProject) {
      const error: CustomError = new Error("Failed to update project");
      error.statusCode = 500;
      throw error;
    }

    if (secrets && secrets.length > 0) {
      const secretsToInsert = secrets.map(
        (s: { key: string; value: string }) => ({
          projectId: updatedProject[0]?.id,
          key: s.key,
          value: encrypt(s.value),
        }),
      );

      await db.insert(secretsTable).values(secretsToInsert);
    }

    res.status(200).json({
      message: "Project updated",
      project: updatedProject[0],
    });
  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
};

export const deleteProject = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;
    const projectId = req.params.projectId;

    if (!projectId) {
      const error: CustomError = new Error("Project ID is required");
      error.statusCode = 400;
      throw error;
    }

    if (!userId) {
      const error: CustomError = new Error("User ID is required");
      error.statusCode = 400;
      throw error;
    }

    const project = await db.query.projectTable.findFirst({
      where: eq(projectTable.id, Number(projectId)),
    });

    if (!project) {
      const error: CustomError = new Error("Project not found");
      error.statusCode = 404;
      throw error;
    }

    if (project.userId !== Number(userId)) {
      const error: CustomError = new Error("Unauthorized");
      error.statusCode = 403;
      throw error;
    }

    await db.delete(projectTable).where(eq(projectTable.id, Number(projectId)));

    res.status(200).json({
      message: "Project deleted",
    });
  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
};

export const deleteSecret = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  try {
    const userId = req.userId;
    const secretId = req.params.secretId

    if (!secretId) {
      const error: CustomError = new Error("Build ID is required");
      error.statusCode = 400;
      throw error;
    }

    if (!userId) {
      const error: CustomError = new Error("User ID is required");
      error.statusCode = 400;
      throw error;
    }

    const secretProject = await db.query.secretsTable.findFirst({
      where: eq(secretsTable.id, Number(secretId)),
      with: {
        project: {
          with: {
            user: true
          }
        }
      }
    });
    if (secretProject?.project?.user.id !== Number(userId)) {
      const error: CustomError = new Error("Unauthorized");
      error.statusCode = 403;
      throw error;
    }

    const [deletedSecrete] = await db.delete(secretsTable).where(eq(secretsTable.id, Number(secretId))).returning()

    if (!deletedSecrete) {
      const error: CustomError = new Error("Failed to delete secret");
      error.statusCode = 500;
      throw error;
    }

    res.status(200).json({
      message: "secret deleted"
    })
  } catch (err) {
    const error = err as CustomError;

    if (!error.statusCode) {
      error.statusCode = 500;
    }

    next(error);
  }
}
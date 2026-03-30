import path from "node:path";
import { decrypt } from "../lib/encryption.js";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import type { CustomError } from "../shared/types.js";
import { db } from "../db/index.js";
import { buildLogs, buildTable } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { DefaultEventsMap, Server } from "socket.io";
import { deployProject } from "./deploymentEngine.js";
import type { NextFunction } from "express";

interface projectInterface {
  id: number;
  createdAt: Date;
  updatedAt: Date;
  name: string;
  branch: string;
  installCommand: string | null;
  buildCommand: string | null;
  outputDirectory: string | null;
  repoUrl: string;
  webhookId: string;
  userId: number;
  user: {
    id: number;
    username: string;
    email: string;
    avatar: string;
    githubToken: string;
    githubId: number;
    createdAt: Date;
    updatedAt: Date;
  };
  secrets: {
    id: number;
    createdAt: Date | null;
    projectId: number | null;
    key: string;
    value: string;
  }[];
}

interface buildInterface {
  id: number;
  branch: string;
  status: "queued" | "running" | "passed" | "failed";
  commit: string;
  commitAuthor: string;
  exitCode: number | null;
  projectId: number;
  startedAt: Date;
  finishedAt: Date | null;
}

export const runBuild = async (
  project: projectInterface,
  repoUrl: string,
  branch: string,
  newBuild: buildInterface,
  io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>,
  next: NextFunction,
) => {
  const buildId = Date.now();
  const folder = `${project.name}-${buildId}`;
  const buildPath = path.join(process.cwd(), "temp", folder);

  fs.mkdirSync(buildPath, { recursive: true });
  let hasEnvFile = false;

  const projectSecrets = project.secrets || [];

  let envContent = "";

  if (projectSecrets.length > 0) {
    const envLines = projectSecrets.map((s) => {
      const plainValue = decrypt(s.value);
      hasEnvFile = true;
      return `${s.key}=${plainValue}`;
    });

    envContent = envLines.join("\n");

    const envFilePath = path.join(buildPath, ".env");

    fs.writeFileSync(envFilePath, envContent);

    console.log(`[CI]: Secrets injected for ${project.name}`);
  } else {
    console.log(
      `[CI]: No secrets found for ${project.name}. Skipping .env creation.`,
    );
  }

  const authenticatedRepoUrl = repoUrl.replace(
    "https://",
    `https://x-access-token:${project.user.githubToken}@`,
  );

  const cloner = spawn(
    "git",
    ["clone", "--branch", branch, authenticatedRepoUrl, "."],
    {
      cwd: buildPath,
    },
  );

  cloner.stderr.on("data", (data) => {
    const isActualError = /error|failed|fatal|exception/i.test(data.toString());
    const logType = isActualError ? "error" : "info";

    if (isActualError) {
      console.error(`[CLONE ERROR]: ${data}`);
    }
  });

  const [cloneExitCode] = await once(cloner, "close");
  if (cloneExitCode !== 0) {
    const error: CustomError = new Error("Git clone failed");
    throw error;
  }

  if (!project.buildCommand) {
    await deployProject(
      project.userId,
      project.id,
      newBuild.id,
      buildPath,
      project.name,
      io,
    );
    fs.rmSync(buildPath, { recursive: true, force: true });
    return;
  }

  let outputDir = project.outputDirectory;

  if (
    fs.existsSync(path.join(buildPath, "vite.config.ts")) ||
    fs.existsSync(path.join(buildPath, "vite.config.js"))
  ) {
    console.log(
      `[CI]: Vite project detected. Setting output directory to 'dist'...`,
    );
    outputDir = "dist";
  } else if (
    fs.existsSync(path.join(buildPath, "next.config.ts")) ||
    fs.existsSync(path.join(buildPath, "next.config.js"))
  ) {
    console.log(
      `[CI]: Next.js project detected. Setting output directory to '.next'...`,
    );
    outputDir = ".next";
  }

  const dockerfilePath = path.join(buildPath, "Dockerfile");

  if (!fs.existsSync(dockerfilePath)) {
    console.log(
      `[CI]: No Dockerfile found. Generating a default Node.js one...`,
    );

    const defaultDockerfile = `
          FROM node:20-slim
          WORKDIR /app
          COPY package*.json ./
          RUN npm install
          COPY . .
          CMD ${project.buildCommand} 
        `.trim();

    fs.writeFileSync(dockerfilePath, defaultDockerfile);
  }

  await db
    .update(buildTable)
    .set({ status: "running" })
    .where(eq(buildTable.id, newBuild.id));

  const imageTag = project.name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-_]/g, "");

  const builder = spawn("docker", ["build", "-t", imageTag, "."], {
    cwd: buildPath,
  });
  const logBuffer: { lineNumber: number; log: string; buildId: number }[] = [];

  let i = 1;
  builder.stdout.on("data", async (data) => {
    const logString = data.toString();

    io.to(project.userId.toString()).emit("build_logs", {
      projectId: project.id,
      log: data.toString(),
      lineNumber: i,
    });
    logBuffer.push({
      lineNumber: i++,
      log: logString,
      buildId: newBuild.id,
    });

    console.log(`[BUILD LOG]: ${logString}`);
  });

  builder.stderr.on("data", async (data) => {
    const logString = data.toString();
    const isActualError = /error|failed|fatal|exception/i.test(logString);
    const logType = isActualError ? "error" : "info";

    io.to(project.userId.toString()).emit("build_errors", {
      projectId: project.id,
      log: data.toString(),
      lineNumber: i,
    });
    logBuffer.push({
      lineNumber: i++,
      log: logString,
      buildId: newBuild.id,
    });

    console.log(`[BUILD ${logType.toUpperCase()}]: ${logString}`);
  });
  builder.on("close", async (code) => {
    if (logBuffer.length > 0) {
      await db.insert(buildLogs).values(logBuffer);
      console.log(`Saved ${logBuffer.length} log lines to DB.`);
    }

    if (code !== 0) {
      const err: CustomError = new Error(
        `[CI]: Build ${newBuild.id} failed with code ${code}`,
      );
      err.statusCode = 500;
      await db
        .update(buildTable)
        .set({ status: "failed", finishedAt: new Date() })
        .where(eq(buildTable.id, newBuild.id));
      next(err);
    } else {
      console.log(`[CI]: Build ${newBuild.id} successful!`);
      logBuffer.length = 0;
      const runArgs = ["run", "--rm"];

      runArgs.push("-v", `${buildPath}:/app`);

      if (process.getuid && process.getgid) {
        runArgs.push("--user", `${process.getuid()}:${process.getgid()}`);
      }

      if (hasEnvFile) {
        runArgs.push("--env-file", ".env");
      }
      runArgs.push(
        imageTag,
        "sh",
        "-c",
        `cd /app && ${project.installCommand || "npm install"} && ${project.buildCommand}`,
      );
      const runner = spawn("docker", runArgs, { cwd: buildPath });

      let j = 1;
      runner.stdout.on("data", async (data) => {
        const logString = data.toString();
        io.to(project.userId.toString()).emit("run_logs", {
          projectId: project.id,
          log: data.toString(),
          lineNumber: j,
        });
        logBuffer.push({
          lineNumber: j++,
          log: logString,
          buildId: newBuild.id,
        });
        console.log(`[TEST LOG]: ${data}`);
      });

      runner.stderr.on("data", async (data) => {
        const logString = data.toString();

        io.to(project.userId.toString()).emit("run_error", {
          projectId: project.id,
          log: data.toString(),
          lineNumber: j,
        });

        logBuffer.push({
          lineNumber: j++,
          log: logString,
          buildId: newBuild.id,
        });
        console.log(`[TEST LOG]: ${data}`);
      });

      runner.on("close", async (code) => {
        try {
          if (logBuffer.length > 0) {
            await db.insert(buildLogs).values(logBuffer);
            console.log(`Saved ${logBuffer.length} log lines to DB.`);
          }

          if (code === 0) {
            console.log("✅ CI PASSED: Code is healthy!");
            await db
              .update(buildTable)
              .set({ status: "passed", finishedAt: new Date() })
              .where(eq(buildTable.id, newBuild.id));

            if (!hasEnvFile) {
              await deployProject(
                project.userId,
                project.id,
                newBuild.id,
                buildPath,
                project.name,
                io,
                outputDir,
              );
            }
          } else {
            const err: CustomError = new Error(
              "CI FAILED: Tests did not pass.",
            );
            err.statusCode = 500;
            await db
              .update(buildTable)
              .set({ status: "failed", finishedAt: new Date() })
              .where(eq(buildTable.id, newBuild.id));
            next(err);
          }

          fs.rmSync(buildPath, { recursive: true, force: true });
        } catch (err) {
          const error: CustomError = new Error(`[CLEANUP ERROR]: ${err}`);
          next(error);
        }
      });
    }
  });
};

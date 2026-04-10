import fs from "node:fs";
import path from "node:path";
import type { DefaultEventsMap, Server } from "socket.io";
import type { CustomError } from "../shared/types.js";
import { db } from "../db/index.js";
import { deploymentTable, projectTable } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const deployProject = async (
  userId: number,
  projectId: number,
  buildId: number,
  buildPath: string,
  name: string,
  io: Server<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, any>,
  isRollback: boolean = false,
  outputDir?: string | null,
) => {
  const folder = name.toLowerCase().replace(/\s+/g, "-");
  const deploymentPath = path.join(process.cwd(), "deployments", folder);
  fs.mkdirSync(deploymentPath, { recursive: true });

  const outputPath = outputDir
    ? path.join(buildPath, outputDir)
    : path.join(buildPath);

  if (!fs.existsSync(outputPath)) {
    const err: CustomError = new Error(
      `[DEPLOYMENT ERROR]: Output directory ${outputPath} does not exist.`,
    );
    err.statusCode = 500;
    throw err;
  }

  if (fs.existsSync(deploymentPath)) {
    fs.rmSync(deploymentPath, { recursive: true, force: true });
  }

  fs.mkdirSync(deploymentPath, { recursive: true });
  fs.cpSync(outputPath, deploymentPath, {
    recursive: true,
    force: true,
  });

  const deployedUrl = `http://${name}.${process.env.BASE_DOMAIN}`;

  io.to(userId.toString()).emit("run_logs", {
    projectId: projectId,
    buildId: buildId,
    log: `🚀 Project deployed at: ${deployedUrl}`,
    lineNumber: 0,
    type: "info"
  });
  console.log(`🚀 Project deployed at: ${deployedUrl}`);

  io.to(userId.toString()).emit("deploymentUpdate", {
    projectId,
    buildId,
    status: "live",
    url: deployedUrl,
  });

  await db.update(projectTable).set({ productionUrl: deployedUrl }).where(eq(projectTable.id, Number(projectId)))

  if (!isRollback) {

    const createDeployment = await db.insert(deploymentTable).values({
      status: "live",
      buildId,
    });
    if (!createDeployment) {
      const err: CustomError = new Error(
        `[DEPLOYMENT ERROR]: Failed to create deployment record in DB.`,
      );
      err.statusCode = 500;
      throw err;
    }
  }

};

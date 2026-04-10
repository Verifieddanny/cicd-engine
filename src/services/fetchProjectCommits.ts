import type { NextFunction } from "express";
import { db } from "../db/index.js";
import { buildTable } from "../db/schema.js";
import { GITHUB_API, type CustomError } from "../shared/types.js";
import * as buildService from "./buildEngine.js";
import type { DefaultEventsMap, Server } from "socket.io";


export const fetchRepoCommit = async (owner: string, repoName: string, branch: string, accessToken: string, project: {
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
    productionUrl: string | null;
    userId: number;
}) => {
    const commitResponse = await fetch(
        `${GITHUB_API}/repos/${owner}/${repoName}/commits/${branch}`,
        {
            method: "GET",
            headers: {
                Authorization: `Bearer ${accessToken}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2026-03-10",
            },
        }
    );

    if (commitResponse.ok) {
        const commitData = await commitResponse.json();

        const latestCommit = {
            hash: commitData.sha,
            message: commitData.commit.message,
            authorName: commitData.commit.author.name,
            authorEmail: commitData.commit.author.email,
            date: commitData.commit.author.date
        };

        const [newBuild] = await db
            .insert(buildTable)
            .values({
                status: "running",
                commit: latestCommit.message,
                branch,
                commitAuthor: latestCommit.authorName,
                projectId: project.id,
                commitHash: latestCommit.hash,
            })
            .returning();
        if (!newBuild) {
            const error: CustomError = new Error("Failed to save build");
            error.statusCode = 500;
            throw error;
        }

        return newBuild;
    } else {
        throw Error("[CI]: Could not fetch initial commit details");
    }

}
import dotenv from "dotenv";
import path from "node:path";
import fs from "node:fs";
import express, {
  type Application,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import cors from "cors";
import type { AuthSocket, CustomError } from "./shared/types.js";

import AuthRouter from "./routes/auth.js";
import { pool } from "./db/index.js";
import { isAuth } from "./middleware/is-auth.js";
import ProjectRouter from "./routes/project.js";
import WebhookRouter from "./routes/webhook.js";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { SocketAuth } from "./middleware/socket-auth.js";
import UserRouter from "./routes/user.js";

dotenv.config();

const app: Application = express();

const ENTRY_POINT = "/api";
const DEPLOYMENT_BASE_PATH = path.join(process.cwd(), "deployments");

const subdomainMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const host = req.headers.host;
  if (!host) {
    return next();
  }

  const subdomain = host.split(".")[0];

  if (subdomain && subdomain !== "www") {
    const deploymentPath = path.join(DEPLOYMENT_BASE_PATH, subdomain);

    if (fs.existsSync(deploymentPath)) {
      return express.static(deploymentPath)(req, res, (err) => {
        if (err) {
          next(err);
        }

        res.sendFile(path.join(deploymentPath, "index.html"), (err) => {
          if (err) {
            next(err);
          }
        });
      });
    }
  }

  next();
};

app.use(express.json());

app.use(cors());

app.use(
  (error: CustomError, _req: Request, res: Response, _next: NextFunction) => {
    const statusCode = error.statusCode || 500;
    const message = error.message;
    const data = error.data;

    res.status(statusCode).json({ message, data });
  },
);

app.use(subdomainMiddleware);

app.use(`${ENTRY_POINT}/auth`, AuthRouter);
app.use(`${ENTRY_POINT}/repo`, isAuth, ProjectRouter);
app.use(`${ENTRY_POINT}/webhook`, WebhookRouter);
app.use(`${ENTRY_POINT}/user`, isAuth, UserRouter);
app.get("/health", (_req, res) => {
  res.status(200).json({ message: "OK" });
});
app.get(`${ENTRY_POINT}`, (_req, res) => {
  res.status(200).json({ message: "Welcome to the CI/CD Pipeline API" });
});

export const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

io.use(SocketAuth);

const startServer = async () => {
  try {
    await pool.query(`SELECT 1`);
    console.log("Database connected");

    io.on("connection", async (socket) => {
      const authSocket = socket as AuthSocket;
      const userId = authSocket.userId;

      if (!userId) {
        console.log("Connection rejected: No User ID");
        return socket.disconnect();
      }
      console.log("User connected:", userId);

      socket.join(userId.toString());

      socket.on("disconnect", async () => {
        console.log("User Disconnected:", userId);
      });
    });
    app.set("io", io);
    server.listen(8080, () => console.log("Server is running on port 8080"));
  } catch (error) {
    console.error("Failed to connect to database:", error);
    process.exit(1);
  }
};

startServer();

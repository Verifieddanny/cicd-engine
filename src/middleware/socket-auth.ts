import type { ExtendedError } from "socket.io";
import jwt from "jsonwebtoken";
import type { AuthSocket, CustomError, UserPayload } from "../shared/types.js";

export const SocketAuth = (
  socket: AuthSocket,
  next: (err?: ExtendedError) => void,
) => {
  const token = socket.handshake.auth.token;

  if (!token) {
    const error = new Error("Not Authenticated") as CustomError;
    return next(error);
  }

  try {
    const decodedToken = jwt.verify(
      token,
      process.env.SECRET!,
    ) as UserPayload;

    if (!decodedToken) {
      return next(new Error("Authentication error"));
    }

    socket.userId = decodedToken.userId;
    next();
  } catch (_err) {
    const error = new Error("Authentication error") as CustomError;
    return next(error);
  }
};

import { verify, sign } from "jsonwebtoken";
import type { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: "missing authorization header" });

  try {
    const token = header.replace("Bearer ", "");
    req.user = verify(token, process.env.JWT_SECRET!);
    next();
  } catch (err: any) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ error: "token expired" });
    if (err.name === "JsonWebTokenError") return res.status(401).json({ error: "invalid token" });
    return res.status(403).json({ error: "insufficient permissions" });
  }
}

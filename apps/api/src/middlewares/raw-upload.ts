import express, { type NextFunction, type Request, type Response } from "express";

/** Reads an upload as raw bytes, answering in JSON (not Express's HTML page) when it is too big. */
export const rawUpload = (maxBytes: number, maxLabel: string) => (req: Request, res: Response, next: NextFunction) =>
  express.raw({ type: () => true, limit: maxBytes })(req, res, (err?: any) => {
    if (!err) return next();
    if (err.type === "entity.too.large") return res.status(413).json({ message: `Files can be up to ${maxLabel}.` });
    return res.status(400).json({ message: "Could not read the file." });
  });

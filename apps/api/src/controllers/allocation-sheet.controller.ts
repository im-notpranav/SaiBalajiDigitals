import { Request, Response } from "express";
import { getSetting, setSetting } from "../utils/app-settings";
import { MAX_SHEET_URL_LENGTH, sheetEmbedUrl } from "../utils/google-sheet";

/**
 * Work Allocation's Sheet View: the team's own Google Sheet, shown inside the app beside the
 * Live Grid. The app only keeps the link; the sheet itself, and who may open or edit it, stay
 * with Google.
 */

async function sheetReply() {
  const url = await getSetting("allocation_sheet_url");
  return { url, embed_url: sheetEmbedUrl(url) };
}

// GET /allocation-sheet — everyone signed in, field staff included (for now). Only the link is
// sent; Google still decides who can open the sheet.
export const getAllocationSheet = async (_req: Request, res: Response) => {
  try {
    res.json(await sheetReply());
  } catch (error) {
    console.error("getAllocationSheet failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /allocation-sheet — Admin only.
export const updateAllocationSheet = async (req: Request, res: Response) => {
  try {
    const url = typeof req.body?.url === "string" ? req.body.url.trim() : "";
    if (!url) return res.status(400).json({ message: "Paste the Google Sheet link." });
    if (url.length > MAX_SHEET_URL_LENGTH) return res.status(400).json({ message: "That link is too long." });
    if (!(await setSetting("allocation_sheet_url", url, req.user!.id))) {
      return res.status(400).json({
        message: "Use a Google Sheets link. It starts with https://docs.google.com/spreadsheets/d/",
      });
    }
    res.json(await sheetReply());
  } catch (error) {
    console.error("updateAllocationSheet failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

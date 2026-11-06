import { Request, Response } from "express";
import { prisma } from "../utils/prisma";
import { deriveYY, RESERVED_NUMBERS } from "../utils/order-sequence";
import { SETTINGS, getSetting, setSetting } from "../utils/app-settings";

// GET /admin/settings/order-sequence
export const getOrderSequence = async (req: Request, res: Response) => {
  try {
    const seq = await prisma.orderSequence.findUnique({
      where: { id: 1 },
    });

    if (!seq) {
      return res.status(404).json({ message: "OrderSequence not initialized" });
    }

    const { last_number, year_code, is_locked } = seq as any;
    
    // Check if the FY is still matching current, for display purpose
    const currentYY = deriveYY();
    let display_last_number = last_number;
    let display_year_code = year_code;
    
    // A year that has rolled over has not been written yet: the next order will be the
    // first past the reservation, not ORD{YY}0001.
    if (display_year_code !== currentYY) {
      display_year_code = currentYY;
      display_last_number = RESERVED_NUMBERS;
    }
    
    const next_order_number = `ORD${display_year_code}${String(display_last_number + 1).padStart(4, "0")}`;

    res.json({
      seq: {
        ...seq,
        year_code: display_year_code,
        last_number: display_last_number,
      },
      next_order_number,
    });
  } catch (error) {
    console.error("Get order sequence error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /admin/settings/order-sequence
export const updateOrderSequence = async (req: Request, res: Response) => {
  try {
    const { next_order_number, is_locked } = req.body;

    const seq = await prisma.orderSequence.findUnique({
      where: { id: 1 },
    });

    if (!seq) {
      return res.status(404).json({ message: "OrderSequence not initialized" });
    }
    
    const currentYY = deriveYY();
    let current_last_number = seq.last_number;
    let current_year_code = seq.year_code;
    const seqAny = seq as any;
    
    if (current_year_code !== currentYY) {
      current_year_code = currentYY;
      current_last_number = RESERVED_NUMBERS;
    }

    let updated_last_number = current_last_number;
    let updated_is_locked = seqAny.is_locked || false;

    if (is_locked !== undefined) {
      updated_is_locked = is_locked;
    }

    if (next_order_number) {
      if (seqAny.is_locked && is_locked !== false) {
        return res.status(400).json({ message: "Sequence is locked. Unlock it first to make adjustments." });
      }

      const match = next_order_number.match(/^ORD(\d{2})(\d{4,})$/);
      if (!match) {
        return res.status(400).json({ message: "Invalid order number format. Must be like ORD260576" });
      }

      const inputYY = match[1];
      const inputNumber = parseInt(match[2], 10);

      if (inputYY !== current_year_code) {
        return res.status(400).json({ message: `Cannot set order number for a different financial year. Expected ORD${current_year_code}...` });
      }

      const new_last_number = inputNumber - 1;

      if (new_last_number < RESERVED_NUMBERS) {
        return res.status(400).json({
          message: `The first ${RESERVED_NUMBERS} numbers of each financial year are reserved. The earliest you can set is ORD${current_year_code}${String(RESERVED_NUMBERS + 1).padStart(4, "0")}.`,
        });
      }

      if (new_last_number < current_last_number) {
        return res.status(400).json({ message: "Cannot set next order number lower than current sequence. Risk of duplicates." });
      }

      updated_last_number = new_last_number;
      
      if (updated_last_number !== current_last_number) {
        await prisma.auditLog.create({
          data: {
            table_name: "OrderSequence",
            record_id: 1,
            action: "UPDATE",
            changed_by: (req as any).user?.id,
            user_name: (req as any).user?.username,
            old_data: { last_number: current_last_number },
            new_data: { last_number: updated_last_number, intended_next_order: next_order_number },
          }
        });
      }
    }
    
    if (is_locked !== undefined && is_locked !== seqAny.is_locked) {
      await prisma.auditLog.create({
        data: {
          table_name: "OrderSequence",
          record_id: 1,
          action: "UPDATE",
          changed_by: (req as any).user?.id,
          user_name: (req as any).user?.username,
          old_data: { is_locked: seqAny.is_locked },
          new_data: { is_locked: is_locked },
        }
      });
    }

    const updatedSeq = await (prisma.orderSequence as any).update({
      where: { id: 1 },
      data: {
        last_number: updated_last_number,
        year_code: current_year_code,
        is_locked: updated_is_locked,
      },
    });

    res.json({ message: "Order sequence updated successfully", seq: updatedSeq });
  } catch (error) {
    console.error("Update order sequence error:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// GET /admin/payment-settings — the overdue threshold for payment requests.
export const getPaymentSettings = async (_req: Request, res: Response) => {
  try {
    res.json({
      payment_overdue_days: await getSetting("payment_overdue_days"),
      payment_admin_threshold: await getSetting("payment_admin_threshold"),
    });
  } catch (error) {
    console.error("getPaymentSettings failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

// PUT /admin/payment-settings — Admin only (the Operation Manager is read-only here).
export const updatePaymentSettings = async (req: Request, res: Response) => {
  try {
    // Either setting may be sent on its own; each is checked before anything is saved.
    const days = req.body?.payment_overdue_days;
    const threshold = req.body?.payment_admin_threshold;
    if (days === undefined && threshold === undefined) {
      return res.status(400).json({ message: "Nothing to save." });
    }
    if (days !== undefined && !SETTINGS.payment_overdue_days.valid(days)) {
      return res.status(400).json({ message: "Enter a whole number of working days from 1 to 90." });
    }
    if (threshold !== undefined && !SETTINGS.payment_admin_threshold.valid(threshold)) {
      return res.status(400).json({ message: "Enter the Admin review limit as a whole number of rupees." });
    }
    if (days !== undefined) await setSetting("payment_overdue_days", days, req.user!.id);
    if (threshold !== undefined) await setSetting("payment_admin_threshold", threshold, req.user!.id);
    res.json({
      payment_overdue_days: await getSetting("payment_overdue_days"),
      payment_admin_threshold: await getSetting("payment_admin_threshold"),
    });
  } catch (error) {
    console.error("updatePaymentSettings failed:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CLOSE_REMARK_TYPES } from "@/lib/constants";
import type { RemarkType } from "@sb-oms/shared-types";

export type CloseRemark = { remarks: RemarkType; text: string };

export const EMPTY_CLOSE_REMARK: CloseRemark = { remarks: "Other", text: "" };

/** A written remark is required whatever the type (the API refuses a blank one too). */
export const closeRemarkReady = (v: CloseRemark) => v.text.trim().length >= 3;

/**
 * Remark type + compulsory written remark for closing or force closing an order.
 * Revised / Extra / Less are not offered: they belong to lines and the order's money.
 */
export function CloseRemarkFields({ value, onChange, idPrefix = "close" }: {
  value: CloseRemark;
  onChange: (v: CloseRemark) => void;
  idPrefix?: string;
}) {
  const missing = !closeRemarkReady(value);
  return (
    <div className="space-y-4">
      <div>
        <label htmlFor={`${idPrefix}-type`} className="mb-1.5 block text-xs font-semibold">Closing remark type</label>
        <Select value={value.remarks} onValueChange={(v) => onChange({ ...value, remarks: v as RemarkType })}>
          <SelectTrigger id={`${idPrefix}-type`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {CLOSE_REMARK_TYPES.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-text`} className="mb-1.5 block text-xs font-semibold">
          Remark <span className="text-destructive">*</span>
        </label>
        <Textarea
          id={`${idPrefix}-text`}
          rows={3}
          value={value.text}
          onChange={(e) => onChange({ ...value, text: e.target.value })}
          placeholder="Why is this order being closed?"
          aria-invalid={missing}
        />
        {missing && <p className="mt-1 text-xs text-destructive">A remark is required to close an order.</p>}
      </div>
    </div>
  );
}

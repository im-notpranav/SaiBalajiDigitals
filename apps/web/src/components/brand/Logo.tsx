import logoAsset from "@/assets/sb-logo.png.asset.json";
import { cn } from "@/lib/utils";

interface LogoProps {
  size?: number;
  className?: string;
}

import { Box } from "lucide-react";

export function Logo({ size = 40, className }: LogoProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-primary shadow-sm",
        className
      )}
      style={{ width: size, height: size }}
    >
      <Box className="text-primary-foreground" size={Math.floor(size * 0.6)} />
    </div>
  );
}

interface BrandLockupProps {
  compact?: boolean;
  logoSize?: number;
  className?: string;
}

export function BrandLockup({ compact = false, logoSize = 40, className }: BrandLockupProps) {
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Logo size={logoSize} />
      <div className="min-w-0 leading-tight">
        <div className="truncate text-[13px] font-bold tracking-wide text-primary-deep sm:text-sm">
          SAI BALAJI DIGITALS PVT LTD
        </div>
        {!compact && (
          <div className="truncate text-[11px] text-muted-foreground">
            Where <span className="font-medium text-primary">Excellence</span> meets{" "}
            <span className="font-medium text-brand-orange">precision</span>
          </div>
        )}
      </div>
    </div>
  );
}

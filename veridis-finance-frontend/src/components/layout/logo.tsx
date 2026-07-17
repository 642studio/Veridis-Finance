import { cn } from "@/lib/utils";

interface LogoProps {
  /** Hide the wordmark, show only the red 642 mark. */
  markOnly?: boolean;
  className?: string;
}

/**
 * 642 Finance brand lockup — the red rounded "642" mark + "Finance" wordmark,
 * matching the 642 Core / 642 CRM ecosystem.
 */
export function Logo({ markOnly = false, className }: LogoProps) {
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <span
        className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-[13px] font-extrabold tracking-tight text-primary-foreground shadow-sm"
        aria-hidden
      >
        642
      </span>
      {markOnly ? null : (
        <span className="font-heading text-lg font-bold tracking-tight text-foreground">
          Finance
        </span>
      )}
    </div>
  );
}

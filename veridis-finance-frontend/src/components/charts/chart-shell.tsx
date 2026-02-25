import { type ReactNode } from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface ChartShellProps {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function ChartShell({
  title,
  description,
  children,
  className,
  contentClassName,
}: ChartShellProps) {
  return (
    <Card className={cn("border-slate-800/80 bg-slate-950/65 text-slate-100", className)}>
      <CardHeader>
        <CardTitle className="text-slate-100">{title}</CardTitle>
        {description ? (
          <CardDescription className="text-slate-400">{description}</CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className={cn("h-80", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

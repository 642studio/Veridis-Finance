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
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent className={cn("h-80", contentClassName)}>{children}</CardContent>
    </Card>
  );
}

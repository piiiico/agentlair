import { Star } from "lucide-react";
import { type ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StepCardProps {
  number: number | string;
  title: string;
  optional?: boolean;
  children: ReactNode;
  className?: string;
}

export function StepCard({
  number,
  title,
  optional = false,
  children,
  className,
}: StepCardProps) {
  return (
    <Card className={cn("", className)}>
      <CardContent className="flex flex-col gap-4 px-6 py-5">
        <div className="flex items-center gap-3">
          {optional ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded px-2 py-0.5",
                "border border-muted-foreground/30 bg-muted/50",
                "font-mono text-sm font-bold text-muted-foreground"
              )}
            >
              <Star className="size-3" />
              {number}
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center justify-center rounded px-2 py-0.5",
                "border border-primary/30 bg-primary/10",
                "font-mono text-sm font-bold text-primary"
              )}
            >
              {number}
            </span>
          )}
          <h3 className="font-display font-semibold leading-tight tracking-tight">
            {title}
          </h3>
          {optional && (
            <span className="text-muted-foreground text-xs">(optional)</span>
          )}
        </div>
        <div className="text-muted-foreground text-sm leading-relaxed">
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description: string;
  badges?: string[];
  className?: string;
}

export function PageHeader({
  title,
  description,
  badges,
  className,
}: PageHeaderProps) {
  return (
    <section className={cn("py-28 lg:py-32 lg:pt-44", className)}>
      <div className="container">
        {badges && badges.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {badges.map((badge) => (
              <Badge key={badge} variant="secondary">
                {badge}
              </Badge>
            ))}
          </div>
        )}
        <h1 className="text-foreground max-w-160 text-3xl tracking-tight md:text-4xl lg:text-5xl">
          {title}
        </h1>
        <p className="text-muted-foreground mt-5 text-xl md:text-2xl">
          {description}
        </p>
      </div>
    </section>
  );
}

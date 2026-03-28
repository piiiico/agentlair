import { cn } from "@/lib/utils";

interface CodeBlockProps {
  code: string;
  language?: string;
  title?: string;
  className?: string;
}

export function CodeBlock({ code, language, title, className }: CodeBlockProps) {
  const showTitleBar = title !== undefined;

  return (
    <div
      className={cn(
        "bg-card relative overflow-hidden rounded-2xl border shadow-lg",
        className
      )}
    >
      {showTitleBar && (
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <div className="size-3 rounded-full bg-red-400/60" />
          <div className="size-3 rounded-full bg-yellow-400/60" />
          <div className="size-3 rounded-full bg-green-400/60" />
          {title && (
            <span className="text-muted-foreground ml-2 font-mono text-xs">
              {title}
            </span>
          )}
        </div>
      )}
      <pre className="overflow-x-auto p-6 font-mono text-sm leading-relaxed">
        <code className={language ? `language-${language}` : undefined}>
          {code}
        </code>
      </pre>
    </div>
  );
}

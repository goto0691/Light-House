import { cn } from "@/lib/utils/cn";

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[\[[^\]]+\]\]|#[\w가-힣-]+)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*")) return <em key={index}>{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("[[") && part.endsWith("]]")) return <span className="text-primary" key={index}>{part}</span>;
    if (part.startsWith("#")) return <span className="text-sky-200" key={index}>{part}</span>;
    return part;
  });
}

export function MarkdownView({ value, className }: { value: string; className?: string }) {
  const blocks = value.trim() ? value.split(/\n{2,}/) : ["내용이 아직 없습니다."];

  return (
    <article className={cn("prose-like space-y-4 text-base leading-8 text-foreground md:text-[17px] md:leading-9", className)}>
      {blocks.map((block, index) => {
        const lines = block.split("\n");
        const first = lines[0] ?? "";
        if (first.startsWith("### ")) return <h3 className="font-display text-2xl text-foreground" key={index}>{inline(first.slice(4))}</h3>;
        if (first.startsWith("## ")) return <h2 className="font-display text-3xl text-foreground" key={index}>{inline(first.slice(3))}</h2>;
        if (first.startsWith("# ")) return <h1 className="font-display text-4xl text-foreground" key={index}>{inline(first.slice(2))}</h1>;
        if (lines.every((line) => line.trim().startsWith("- "))) {
          return (
            <ul className="space-y-2 pl-5" key={index}>
              {lines.map((line) => <li className="list-disc text-muted-foreground" key={line}>{inline(line.trim().slice(2))}</li>)}
            </ul>
          );
        }
        if (first.startsWith("> ")) {
          return <blockquote className="border-l-2 border-primary/40 pl-4 text-muted-foreground" key={index}>{inline(block.replace(/^>\s?/gm, ""))}</blockquote>;
        }
        return <p className="whitespace-pre-wrap text-muted-foreground" key={index}>{inline(block)}</p>;
      })}
    </article>
  );
}

type HeatmapCell = {
  date: string;
  value: number;
};

export function Heatmap({ data }: { data: HeatmapCell[] }) {
  return (
    <div className="grid grid-cols-[repeat(53,minmax(0,1fr))] gap-1">
      {data.map((cell) => (
        <div
          className="aspect-square rounded-[4px]"
          key={cell.date}
          style={{
            background:
              cell.value === 0
                ? "hsl(var(--muted) / 0.45)"
                : cell.value === 1
                  ? "hsl(var(--primary) / 0.18)"
                  : cell.value === 2
                    ? "hsl(var(--primary) / 0.32)"
                    : cell.value === 3
                      ? "hsl(var(--primary) / 0.5)"
                      : "hsl(var(--primary) / 0.75)",
          }}
          title={`${cell.date} · ${cell.value}`}
        />
      ))}
    </div>
  );
}

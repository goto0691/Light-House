type SparklineProps = {
  data: number[];
  className?: string;
};

export function Sparkline({ className, data }: SparklineProps) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const points = data
    .map((value, index) => {
      const x = (index / Math.max(data.length - 1, 1)) * 100;
      const y = 100 - ((value - min) / range) * 100;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className={className} fill="none" viewBox="0 0 100 100">
      <polyline points={points} stroke="hsl(var(--primary))" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
    </svg>
  );
}

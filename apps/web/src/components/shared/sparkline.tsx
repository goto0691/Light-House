type SparklineProps = {
  data: number[];
  className?: string;
  height?: number;
  color?: string;
  showDot?: boolean;
};

export function Sparkline({ className, color = "hsl(var(--primary))", data, height = 100, showDot = true }: SparklineProps) {
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
  const last = data[data.length - 1];
  const lastY = 100 - ((last - min) / range) * 100;

  return (
    <svg className={className} fill="none" style={{ height }} viewBox="0 0 100 100">
      <polyline points={points} stroke={color} strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
      {showDot ? <circle cx="100" cy={lastY} fill={color} r="4.5" /> : null}
    </svg>
  );
}

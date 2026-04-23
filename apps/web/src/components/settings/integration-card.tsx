type IntegrationCardProps = {
  label: string;
  configured: boolean;
};

export function IntegrationCard({ label, configured }: IntegrationCardProps) {
  return (
    <div className="flex items-center justify-between rounded-3xl border border-white/10 bg-white/5 px-4 py-3">
      <span className="text-sm text-foreground">{label}</span>
      <span className={configured ? "text-sm text-primary" : "text-sm text-muted-foreground"}>{configured ? "Configured" : "Pending"}</span>
    </div>
  );
}

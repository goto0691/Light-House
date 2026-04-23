type AIUsagePanelProps = {
  usage: {
    conversations: number;
    inputTokens: number;
    outputTokens: number;
  };
  recentConversations: Array<{
    id: string;
    purpose: string;
    model: string;
    createdAt: string;
  }>;
  summary: string;
};

export function AIUsagePanel({ usage, recentConversations, summary }: AIUsagePanelProps) {
  return (
    <section className="rounded-[28px] border border-white/10 bg-white/5 p-5">
      <p className="text-xs uppercase tracking-[0.24em] text-primary">AI Usage Panel</p>
      <h2 className="mt-3 font-display text-4xl text-foreground">월간 사용량</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Conversations</p>
          <p className="mt-2 text-2xl font-semibold">{usage.conversations}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Input Tokens</p>
          <p className="mt-2 text-2xl font-semibold">{usage.inputTokens}</p>
        </div>
        <div className="rounded-3xl border border-white/10 bg-white/5 p-4">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Output Tokens</p>
          <p className="mt-2 text-2xl font-semibold">{usage.outputTokens}</p>
        </div>
      </div>
      <div className="mt-5 rounded-3xl border border-white/10 bg-black/10 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recent</p>
        <div className="mt-3 space-y-2">
          {recentConversations.length ? (
            recentConversations.map((item) => (
              <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm" key={item.id}>
                <span className="text-foreground">{item.purpose}</span>
                <span className="text-muted-foreground">{item.model}</span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">아직 기록된 AI 대화가 없습니다.</p>
          )}
        </div>
      </div>
      <div className="mt-5 rounded-3xl border border-white/10 bg-black/10 p-4">
        <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Summary Preview</p>
        <pre className="mt-3 whitespace-pre-wrap text-sm text-foreground">{summary || "아직 생성된 요약이 없습니다."}</pre>
      </div>
    </section>
  );
}

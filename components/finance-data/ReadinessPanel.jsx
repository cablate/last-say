import { AlertTriangle, ArrowRight, CheckCircle2, CircleOff, Clock3, FileCheck2, ListTodo } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const GOALS = {
  spending_history: '消費歷史', cash_position: '現金部位', net_worth: '淨資產', debt_obligations: '債務與承諾',
  investment_value: '投資現值', cash_flow_statement: '現金流量表', liquidity_forecast_90d: '90 天流動性', tax_or_derivatives: '稅務與衍生品',
};

const STATUS = {
  complete: { label: '可分析', variant: 'default', icon: CheckCircle2 }, partial: { label: '資料不完整', variant: 'outline', icon: AlertTriangle },
  empty: { label: '尚無資料', variant: 'secondary', icon: CircleOff }, stale: { label: '資料過期', variant: 'outline', icon: Clock3 },
  conflicted: { label: '來源衝突', variant: 'destructive', icon: AlertTriangle }, unreconciled: { label: '尚未對帳', variant: 'outline', icon: AlertTriangle },
  unsupported: { label: '目前不支援', variant: 'secondary', icon: CircleOff },
};

function ReadinessRow({ goal, readiness }) {
  const state = STATUS[readiness?.status] || STATUS.empty;
  const Icon = state.icon;
  const gap = readiness?.gaps?.[0];
  return <article className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(10rem,0.65fr)_minmax(0,1.35fr)_auto] md:items-center">
    <div className="flex items-center gap-2"><Icon className="size-4 text-muted-foreground" aria-hidden="true" /><h3 className="font-medium">{GOALS[goal] || goal}</h3></div>
    <div className="min-w-0"><p className="text-sm">{gap ? gap.gap : '必要資料與範圍已通過目前政策。'}</p><p className="mt-1 text-xs text-muted-foreground">{gap ? `下一步：${gap.next_action} · 影響：${gap.impact}` : `截至 ${readiness?.as_of_date || '目前日期'} · ${readiness?.scope?.kind === 'account' ? '單一帳戶' : '全域範圍'}`}</p></div>
    <Badge variant={state.variant} className="justify-self-start md:justify-self-end">{state.label}</Badge>
  </article>;
}

export default function ReadinessPanel({ inventory }) {
  const readiness = inventory.readiness || {};
  const sourceCoverage = inventory.source_coverage || [];
  const reviewCounts = inventory.review_counts || [];
  const openReviews = reviewCounts.filter((item) => item.status === 'open').reduce((sum, item) => sum + Number(item.count), 0);
  return <div className="space-y-7">
    <section className="grid gap-4 border-b pb-6 md:grid-cols-[minmax(0,1.4fr)_minmax(15rem,0.8fr)]"><div><div className="flex items-center gap-2"><FileCheck2 className="size-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">分析就緒度</h2><Badge variant="outline">{inventory.policy_version}</Badge></div><p className="mt-2 max-w-2xl text-sm text-muted-foreground">先判斷資料範圍、時效與衝突，再交給 AI 分析。完整只代表指定目標與範圍，不代表所有財務資料都齊全。</p></div><dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-muted-foreground">待處理</dt><dd className="mt-1 flex items-center gap-2 font-mono text-lg"><ListTodo className="size-4" aria-hidden="true" />{openReviews}</dd></div><div><dt className="text-muted-foreground">來源群組</dt><dd className="mt-1 font-mono text-lg">{sourceCoverage.length}</dd></div></dl></section>
    <section aria-labelledby="readiness-goals-title"><div className="mb-3 flex items-center gap-2"><h2 id="readiness-goals-title" className="font-semibold">可回答的問題</h2><span className="text-sm tabular-nums text-muted-foreground">{Object.keys(readiness).length}</span></div><div className="divide-y rounded-md border">{Object.entries(readiness).map(([goal, value]) => <ReadinessRow key={goal} goal={goal} readiness={value} />)}</div></section>
    <section aria-labelledby="source-coverage-title"><div className="mb-3 flex items-center gap-2"><h2 id="source-coverage-title" className="font-semibold">來源覆蓋</h2><span className="text-sm text-muted-foreground">僅顯示聚合資訊，不暴露檔名</span></div>{sourceCoverage.length ? <div className="divide-y rounded-md border">{sourceCoverage.map((item) => <div key={`${item.source_kind}-${item.authority}-${item.status}`} className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><p className="font-medium">{item.source_kind}</p><p className="text-xs text-muted-foreground">{item.authority} · {item.period_start || '未提供起日'} 至 {item.period_end || '未提供迄日'}</p></div><div className="flex items-center gap-2 text-sm tabular-nums"><span>{item.count} 份</span><ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" /></div></div>)}</div> : <p className="rounded-md border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">尚未登錄來源證據。請先由 AI 建立來源與匯入 preview。</p>}</section>
  </div>;
}

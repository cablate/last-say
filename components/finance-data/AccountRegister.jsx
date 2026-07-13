'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, CircleDollarSign, Database, Pencil, Plus, RefreshCw, ShieldAlert, WalletCards } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS = {
  current: { label: '最新', variant: 'default' }, missing: { label: '缺餘額', variant: 'secondary' },
  stale: { label: '已過期', variant: 'outline' }, conflicted: { label: '有衝突', variant: 'destructive' },
  needs_review: { label: '待確認', variant: 'outline' }, partial: { label: '資料不完整', variant: 'outline' },
  complete: { label: '可分析', variant: 'default' }, empty: { label: '尚無資料', variant: 'secondary' },
};

function formatMinor(amount, currency = 'TWD') {
  if (amount === null || amount === undefined) return '尚未提供';
  try {
    const minor = BigInt(amount); const whole = minor / 100n; const fraction = (minor < 0n ? -minor : minor) % 100n;
    return `${new Intl.NumberFormat('zh-TW', { style: 'currency', currency, maximumFractionDigits: 0 }).format(whole)}${fraction ? `.${fraction.toString().padStart(2, '0')}` : ''}`;
  } catch { return String(amount); }
}

function StatusBadge({ status }) {
  const value = STATUS[status] || { label: status || '未知', variant: 'secondary' };
  return <Badge variant={value.variant}>{value.label}</Badge>;
}

function LoadingState() {
  return <div className="space-y-3" aria-label="正在載入帳戶資料">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-24 w-full rounded-md" />)}</div>;
}

function majorToMinor(value) {
  const match = String(value).trim().match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) throw new Error('請輸入有效金額，最多兩位小數。');
  const minor = BigInt(match[2]) * 100n + BigInt((match[3] || '').padEnd(2, '0') || '0');
  return `${match[1]}${minor}`;
}

function localDate() { return new Date().toLocaleDateString('en-CA'); }

function AccountDialog({ open, account, onOpenChange, onSaved }) {
  const [name, setName] = useState(''); const [kind, setKind] = useState('bank'); const [saving, setSaving] = useState(false); const [error, setError] = useState(null);
  useEffect(() => { if (open) { setName(account?.display_name || ''); setKind(account?.account_kind || 'bank'); setError(null); } }, [open, account]);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const payload = account ? { display_name: name, entity_key: account.entity_key, account_kind: kind, currency: account.currency, normal_balance: account.normal_balance, liquidity_class: account.liquidity_class, masked_number: account.masked_number, active: Boolean(account.active), included_in_analysis: Boolean(account.included_in_analysis), authority: account.authority, review_state: account.review_state, expected_version: account.version } : { display_name: name, account_kind: kind, currency: 'TWD', authority: 'user_confirmed', review_state: 'confirmed' };
      const response = await fetch(account ? `/api/finance/accounts/${account.account_key}` : '/api/finance/accounts', { method: account ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || '帳戶儲存失敗');
      onOpenChange(false); await onSaved();
    } catch (reason) { setError(reason.message); } finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>{account ? '編輯帳戶' : '新增帳戶'}</DialogTitle><DialogDescription>帳戶身分會影響盤點範圍與後續分析。</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submit}><div className="space-y-2"><Label htmlFor="account-name">帳戶名稱</Label><Input id="account-name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} /></div><div className="space-y-2"><Label htmlFor="account-kind">帳戶類型</Label><Select value={kind} onValueChange={setKind}><SelectTrigger id="account-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="bank">銀行帳戶</SelectItem><SelectItem value="cash">現金</SelectItem><SelectItem value="e_wallet">電子錢包</SelectItem><SelectItem value="credit_card">信用卡</SelectItem></SelectContent></Select></div>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving || !name.trim()}>{saving ? '儲存中' : '儲存'}</Button></DialogFooter></form></DialogContent></Dialog>;
}

function BalanceDialog({ open, account, onOpenChange, onSaved }) {
  const [amount, setAmount] = useState(''); const [date, setDate] = useState(localDate()); const [kind, setKind] = useState('ledger'); const [saving, setSaving] = useState(false); const [error, setError] = useState(null);
  useEffect(() => { if (open) { setAmount(''); setDate(localDate()); setKind('ledger'); setError(null); } }, [open, account]);
  async function submit(event) {
    event.preventDefault(); setSaving(true); setError(null);
    try {
      const payload = { account_key: account.account_key, as_of_date: date, observed_at: new Date().toISOString(), balance_kind: kind, amount_minor: majorToMinor(amount), currency: account.currency, authority: 'user_confirmed', review_state: 'confirmed', note: '由資料中心手動輸入' };
      const response = await fetch('/api/finance/balance-snapshots', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || '餘額儲存失敗');
      onOpenChange(false); await onSaved();
    } catch (reason) { setError(reason.message); } finally { setSaving(false); }
  }
  return <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}><DialogContent className="sm:max-w-md"><DialogHeader><DialogTitle>更新餘額</DialogTitle><DialogDescription>{account?.display_name}。新 snapshot 會保留舊紀錄，不會覆寫來源事實。</DialogDescription></DialogHeader>{account ? <form className="space-y-4" onSubmit={submit}><div className="space-y-2"><Label htmlFor="balance-amount">餘額（{account.currency}）</Label><Input id="balance-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="例如 123456.78" required /></div><div className="space-y-2"><Label htmlFor="balance-date">餘額日期</Label><Input id="balance-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></div><div className="space-y-2"><Label htmlFor="balance-kind">餘額類型</Label><Select value={kind} onValueChange={setKind}><SelectTrigger id="balance-kind" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ledger">帳面餘額</SelectItem><SelectItem value="available">可用餘額</SelectItem><SelectItem value="statement">帳單餘額</SelectItem><SelectItem value="cash">現金</SelectItem></SelectContent></Select></div>{error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}<DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button type="submit" disabled={saving || !amount || !date}>{saving ? '儲存中' : '新增 snapshot'}</Button></DialogFooter></form> : null}</DialogContent></Dialog>;
}

export default function AccountRegister() {
  const [state, setState] = useState({ loading: true, error: null, inventory: null });
  const [accountDialog, setAccountDialog] = useState({ open: false, account: null });
  const [balanceAccount, setBalanceAccount] = useState(null);
  const load = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: null }));
    try {
      const response = await fetch('/api/finance/inventory', { cache: 'no-store' }); const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || '資料中心載入失敗');
      setState({ loading: false, error: null, inventory: body.inventory });
    } catch (error) { setState((current) => ({ ...current, loading: false, error: error.message })); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const inventory = state.inventory; const accounts = inventory?.accounts || []; const cash = inventory?.readiness?.cash_position;
  return (
    <section className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:py-8" aria-labelledby="data-center-title">
      <header className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">財務資料中心</p>
          <h2 id="data-center-title" className="text-2xl font-semibold">帳戶與餘額</h2>
          <p className="max-w-2xl text-sm text-muted-foreground">查看 AI 可用的帳戶範圍、餘額證據日期與待補缺口。</p>
        </div>
        <div className="flex gap-2"><Button size="sm" onClick={() => setAccountDialog({ open: true, account: null })}><Plus aria-hidden="true" />新增帳戶</Button><Button variant="outline" size="sm" onClick={load} disabled={state.loading}><RefreshCw className={state.loading ? 'animate-spin' : ''} aria-hidden="true" />重新整理</Button></div>
      </header>

      {state.error ? <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertTitle>資料載入失敗</AlertTitle><AlertDescription>{state.error}</AlertDescription></Alert> : null}
      {state.loading && !inventory ? <LoadingState /> : null}

      {inventory ? <>
        <section className="grid gap-4 border-b pb-6 md:grid-cols-[minmax(0,1.6fr)_minmax(15rem,0.8fr)]">
          <div className="space-y-2">
            <div className="flex items-center gap-2"><CircleDollarSign className="size-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">現金部位準備度</h2><StatusBadge status={cash?.status} /></div>
            <p className="text-sm text-muted-foreground">截至 {cash?.as_of_date || inventory.as_of_date}，共有 {accounts.filter((item) => item.active).length} 個有效帳戶。</p>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 font-medium"><ShieldAlert className="size-4 text-warning" aria-hidden="true" />仍需處理 {cash?.gaps?.length || 0} 個缺口</div>
            <p className="text-muted-foreground">{cash?.gaps?.[0]?.gap === 'missing_scope_attestation' ? '尚未由你確認現金帳戶盤點範圍。' : cash?.gaps?.[0]?.gap || '目前沒有阻擋分析的缺口。'}</p>
          </div>
        </section>

        <section className="space-y-3" aria-labelledby="accounts-title">
          <div className="flex items-center gap-2"><Database className="size-5 text-primary" aria-hidden="true" /><h2 id="accounts-title" className="font-semibold">帳戶登錄</h2><span className="text-sm tabular-nums text-muted-foreground">{accounts.length}</span></div>
          {accounts.length === 0 ? <div className="rounded-md border border-dashed px-6 py-12 text-center"><p className="font-medium">尚未建立帳戶</p><p className="mt-1 text-sm text-muted-foreground">由 AI 先用 structured ingestion preview 提案，再由你確認匯入內容。</p></div> :
            <div className="divide-y rounded-md border">
              {accounts.map((account) => {
                const balance = account.balance; const selected = balance?.selected;
                return <article key={account.account_key} className="@container grid gap-4 px-4 py-4 sm:px-5 @md:grid-cols-[minmax(0,1fr)_minmax(13rem,0.7fr)_auto] @md:items-center">
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-medium">{account.display_name}</h3><Badge variant="outline">{account.account_kind}</Badge>{!account.active ? <Badge variant="secondary">已停用</Badge> : null}</div><p className="mt-1 truncate text-xs text-muted-foreground">{account.institution_name || '未指定機構'} · {account.currency} · {account.masked_number || '無遮罩識別'}</p></div>
                  <div><p className="font-mono text-lg font-semibold tabular-nums">{formatMinor(selected?.amount_minor, selected?.currency || account.currency)}</p><p className="text-xs text-muted-foreground">{selected ? `${selected.as_of_date} · ${selected.balance_kind} · ${selected.source_key ? '有來源' : '無來源'}` : '尚無可用餘額 snapshot'}</p></div>
                  <div className="flex flex-wrap items-center gap-2 justify-self-start @md:justify-self-end"><StatusBadge status={balance?.status || 'missing'} /><Button variant="ghost" size="icon-sm" title="編輯帳戶" aria-label={`編輯 ${account.display_name}`} onClick={() => setAccountDialog({ open: true, account })}><Pencil aria-hidden="true" /></Button><Button variant="outline" size="sm" onClick={() => setBalanceAccount(account)}><WalletCards aria-hidden="true" />更新餘額</Button></div>
                </article>;
              })}
            </div>}
        </section>
      </> : null}
      <AccountDialog open={accountDialog.open} account={accountDialog.account} onOpenChange={(open) => setAccountDialog((current) => ({ ...current, open }))} onSaved={load} />
      <BalanceDialog open={Boolean(balanceAccount)} account={balanceAccount} onOpenChange={(open) => !open && setBalanceAccount(null)} onSaved={load} />
    </section>
  );
}

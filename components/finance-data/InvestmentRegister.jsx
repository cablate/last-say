'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, BadgeDollarSign, Clock3, LineChart, Plus } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ENUMS, SUPPORTED_CURRENCIES } from '@/lib/finance/contracts/enums';
import { currencyInputMode, currencyInputPlaceholder, formatMoneyMinor, majorToMinorExact } from '@/lib/finance/money/presentation';
import { displayAccountLabel, displayCurrency, displayInstrumentName, displayInstrumentSymbol, displayInstrumentType } from '@/lib/finance/presentation-labels';

const STATUS = { current: '估值可用', stale: '報價過期', missing_quote: '缺報價', missing_fx: '缺匯率', currency_mismatch: '幣別衝突' };

function localDate() { return new Date().toLocaleDateString('en-CA'); }

function EntryDialog({ kind, open, accounts, instruments, onOpenChange, onSaved }) {
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const investmentAccounts = accounts.filter((account) => account.account_kind === 'investment' && account.active);
  const selectedInstrument = instruments.find((item) => item.instrument_key === form.instrument_key);
  const instrumentCurrency = selectedInstrument?.quote_currency || 'TWD';

  useEffect(() => {
    if (!open) return;
    setForm({
      instrument_type: 'stock',
      quote_currency: 'TWD',
      base_currency: 'USD',
      as_of_date: localDate(),
    });
    setError(null);
  }, [open, kind]);

  function field(name, value) { setForm((current) => ({ ...current, [name]: value })); }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      let url;
      let payload;
      if (kind === 'instrument') {
        url = '/api/finance/investments/instruments';
        payload = {
          instrument_type: form.instrument_type,
          name: form.name,
          symbol: form.symbol || null,
          exchange: form.exchange || null,
          quote_currency: form.quote_currency,
          authority: 'user_confirmed',
          review_state: 'confirmed',
        };
      } else if (kind === 'holding') {
        url = '/api/finance/investments/manual-holdings';
        payload = {
          account_key: form.account_key,
          instrument_key: form.instrument_key,
          as_of_date: form.as_of_date,
          quantity_decimal: form.quantity_decimal,
          reported_market_value_minor: form.reported_market_value ? majorToMinorExact(form.reported_market_value, instrumentCurrency) : null,
          reported_cost_basis_minor: form.reported_cost_basis ? majorToMinorExact(form.reported_cost_basis, instrumentCurrency) : null,
          source_description: form.source_description || undefined,
        };
      } else if (kind === 'quote') {
        url = '/api/finance/investments/manual-quotes';
        payload = {
          instrument_key: form.instrument_key,
          as_of_date: form.as_of_date,
          price_decimal: form.price_decimal,
          provider: form.provider || undefined,
          source_description: form.source_description || undefined,
        };
      } else {
        url = '/api/finance/investments/manual-fx-quotes';
        payload = {
          base_currency: form.base_currency,
          quote_currency: form.quote_currency,
          as_of_date: form.as_of_date,
          rate_decimal: form.rate_decimal,
          provider: form.provider || undefined,
          source_description: form.source_description || undefined,
        };
      }
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || '投資資料儲存失敗');
      onOpenChange(false);
      await onSaved();
    } catch (reason) {
      setError(reason.message);
    } finally {
      setSaving(false);
    }
  }

  const titles = { instrument: '新增投資工具', holding: '新增持倉快照', quote: '新增市場報價', fx: '新增匯率' };
  const descriptions = {
    instrument: '建立股票、ETF 或其他有報價資產的穩定身分。',
    holding: '手動持倉會同時建立「本人確認」來源證據與估值快照。',
    quote: '手動報價會標記為人工估值，不會冒充官方市場資料。',
    fx: '匯率方向為 1 單位基準幣可換多少報價幣，例如 USD/TWD 32.5。',
  };
  const cannotSubmit = saving
    || (kind === 'instrument' && !form.name?.trim())
    || (kind === 'holding' && (!form.account_key || !form.instrument_key || !form.quantity_decimal || !form.as_of_date))
    || (kind === 'quote' && (!form.instrument_key || !form.price_decimal || !form.as_of_date))
    || (kind === 'fx' && (!form.base_currency || !form.quote_currency || !form.rate_decimal || !form.as_of_date));

  return <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{titles[kind]}</DialogTitle><DialogDescription>{descriptions[kind]}</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={submit} aria-describedby={error ? 'investment-entry-error' : undefined}>
    {kind === 'instrument' ? <>
      <div className="space-y-2"><Label htmlFor="instrument-name">工具名稱</Label><Input id="instrument-name" value={form.name || ''} onChange={(event) => field('name', event.target.value)} placeholder="例如：某某全球 ETF" required maxLength={200} /></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="instrument-type">工具類型</Label><Select value={form.instrument_type} onValueChange={(value) => field('instrument_type', value)}><SelectTrigger id="instrument-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{ENUMS.instrument_type.map((value) => <SelectItem key={value} value={value}>{displayInstrumentType(value)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="instrument-currency">報價幣別</Label><Select value={form.quote_currency} onValueChange={(value) => field('quote_currency', value)}><SelectTrigger id="instrument-currency" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_CURRENCIES.map((value) => <SelectItem key={value} value={value}>{displayCurrency(value)}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="instrument-symbol">代號（選填）</Label><Input id="instrument-symbol" value={form.symbol || ''} onChange={(event) => field('symbol', event.target.value)} placeholder="例如 0050" /></div><div className="space-y-2"><Label htmlFor="instrument-exchange">交易所（選填）</Label><Input id="instrument-exchange" value={form.exchange || ''} onChange={(event) => field('exchange', event.target.value)} placeholder="例如 TWSE" /></div></div>
    </> : null}

    {kind === 'holding' ? <>
      <div className="space-y-2"><Label htmlFor="holding-account">投資帳戶</Label><Select value={form.account_key || ''} onValueChange={(value) => field('account_key', value)}><SelectTrigger id="holding-account" className="w-full"><SelectValue placeholder="選擇投資帳戶" /></SelectTrigger><SelectContent>{investmentAccounts.map((account) => <SelectItem key={account.account_key} value={account.account_key}>{displayAccountLabel(account)} · {displayCurrency(account.currency)}</SelectItem>)}</SelectContent></Select>{investmentAccounts.length === 0 ? <p className="text-xs text-muted-foreground">請先在帳戶分頁新增「投資帳戶」。</p> : null}</div>
      <div className="space-y-2"><Label htmlFor="holding-instrument">投資工具</Label><Select value={form.instrument_key || ''} onValueChange={(value) => field('instrument_key', value)}><SelectTrigger id="holding-instrument" className="w-full"><SelectValue placeholder="選擇已建立工具" /></SelectTrigger><SelectContent>{instruments.map((item) => <SelectItem key={item.instrument_key} value={item.instrument_key}>{displayInstrumentName(item.name)} · {displayCurrency(item.quote_currency)}</SelectItem>)}</SelectContent></Select>{instruments.length === 0 ? <p className="text-xs text-muted-foreground">請先新增投資工具。</p> : null}</div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="holding-quantity">持有數量</Label><Input id="holding-quantity" inputMode="decimal" value={form.quantity_decimal || ''} onChange={(event) => field('quantity_decimal', event.target.value)} placeholder="例如 10.25" required /></div><div className="space-y-2"><Label htmlFor="holding-date">持倉日期</Label><Input id="holding-date" type="date" value={form.as_of_date || ''} onChange={(event) => field('as_of_date', event.target.value)} required /></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="holding-value">來源報告市值（{displayCurrency(instrumentCurrency)}，選填）</Label><Input id="holding-value" inputMode={currencyInputMode(instrumentCurrency)} value={form.reported_market_value || ''} onChange={(event) => field('reported_market_value', event.target.value)} placeholder={currencyInputPlaceholder(instrumentCurrency)} /></div><div className="space-y-2"><Label htmlFor="holding-cost">來源報告成本（{displayCurrency(instrumentCurrency)}，選填）</Label><Input id="holding-cost" inputMode={currencyInputMode(instrumentCurrency)} value={form.reported_cost_basis || ''} onChange={(event) => field('reported_cost_basis', event.target.value)} placeholder={currencyInputPlaceholder(instrumentCurrency)} /></div></div>
    </> : null}

    {kind === 'quote' ? <>
      <div className="space-y-2"><Label htmlFor="quote-instrument">投資工具</Label><Select value={form.instrument_key || ''} onValueChange={(value) => field('instrument_key', value)}><SelectTrigger id="quote-instrument" className="w-full"><SelectValue placeholder="選擇已建立工具" /></SelectTrigger><SelectContent>{instruments.map((item) => <SelectItem key={item.instrument_key} value={item.instrument_key}>{displayInstrumentName(item.name)} · {displayCurrency(item.quote_currency)}</SelectItem>)}</SelectContent></Select></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="quote-price">每單位價格（{displayCurrency(instrumentCurrency)}）</Label><Input id="quote-price" inputMode="decimal" value={form.price_decimal || ''} onChange={(event) => field('price_decimal', event.target.value)} placeholder="例如 101.23" required /></div><div className="space-y-2"><Label htmlFor="quote-date">報價日期</Label><Input id="quote-date" type="date" value={form.as_of_date || ''} onChange={(event) => field('as_of_date', event.target.value)} required /></div></div>
    </> : null}

    {kind === 'fx' ? <>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="fx-base">基準幣</Label><Select value={form.base_currency} onValueChange={(value) => field('base_currency', value)}><SelectTrigger id="fx-base" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_CURRENCIES.map((value) => <SelectItem key={value} value={value}>{displayCurrency(value)}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="fx-quote">報價幣</Label><Select value={form.quote_currency} onValueChange={(value) => field('quote_currency', value)}><SelectTrigger id="fx-quote" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{SUPPORTED_CURRENCIES.map((value) => <SelectItem key={value} value={value}>{displayCurrency(value)}</SelectItem>)}</SelectContent></Select></div></div>
      <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="fx-rate">匯率</Label><Input id="fx-rate" inputMode="decimal" value={form.rate_decimal || ''} onChange={(event) => field('rate_decimal', event.target.value)} placeholder="例如 32.5" required /></div><div className="space-y-2"><Label htmlFor="fx-date">匯率日期</Label><Input id="fx-date" type="date" value={form.as_of_date || ''} onChange={(event) => field('as_of_date', event.target.value)} required /></div></div>
    </> : null}

    {kind !== 'instrument' ? <div className="space-y-2"><Label htmlFor="investment-source-note">來源說明（選填）</Label><Input id="investment-source-note" value={form.source_description || ''} onChange={(event) => field('source_description', event.target.value)} placeholder="例如：依 7/15 券商畫面手動確認" maxLength={500} /></div> : null}
    {error ? <p id="investment-entry-error" className="text-sm text-destructive" role="alert">{error}</p> : null}
    <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>取消</Button><Button type="submit" disabled={cannotSubmit}>{saving ? '儲存中' : '儲存'}</Button></DialogFooter>
  </form></DialogContent></Dialog>;
}

export default function InvestmentRegister({ inventory, onSaved }) {
  const [instruments, setInstruments] = useState([]);
  const [instrumentError, setInstrumentError] = useState(null);
  const [dialog, setDialog] = useState(null);
  const activeInstruments = instruments.filter((item) => item.active);
  const positions = inventory.investments || [];
  const readiness = inventory.readiness?.investment_value;

  const loadInstruments = useCallback(async () => {
    try {
      const response = await fetch('/api/finance/investments/instruments', { cache: 'no-store' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || '投資工具讀取失敗');
      setInstruments(body.instruments || []);
      setInstrumentError(null);
    } catch (error) {
      setInstrumentError(error.message);
    }
  }, []);

  useEffect(() => { loadInstruments(); }, [loadInstruments]);

  async function refresh() {
    await Promise.all([loadInstruments(), onSaved?.()]);
  }

  return <div className="space-y-8">
    <section className="grid gap-4 border-b pb-6 md:grid-cols-[minmax(0,1.4fr)_minmax(14rem,0.8fr)]"><div><div className="flex flex-wrap items-center gap-2"><LineChart className="size-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">投資估值準備度</h2><Badge variant={readiness?.status === 'complete' ? 'default' : 'outline'}>{readiness?.status === 'complete' ? '可分析' : '資料不完整'}</Badge></div><p className="mt-2 text-sm text-muted-foreground">持倉、來源報告價值與工具推導估值分開呈現；缺報價或匯率時不湊總額。</p></div><div className="text-sm"><p className="font-medium">仍需處理 {readiness?.gaps?.length || 0} 個缺口</p><p className="mt-1 text-muted-foreground">{readiness?.gaps?.[0]?.gap ? '仍有投資資料需要補齊。' : '目前沒有阻擋估值的缺口。'}</p></div></section>

    {instrumentError ? <Alert variant="destructive"><AlertCircle aria-hidden="true" /><AlertDescription>{instrumentError}</AlertDescription></Alert> : null}

    <section className="space-y-3" aria-labelledby="investment-actions-title"><div><h2 id="investment-actions-title" className="font-semibold">人工估值資料</h2><p className="mt-1 text-sm text-muted-foreground">適合先建立目前持倉與估值；正式券商報表與交易仍建議由 AI 走預覽／確認流程匯入。</p></div><div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => setDialog('instrument')}><Plus aria-hidden="true" />投資工具</Button><Button size="sm" variant="outline" onClick={() => setDialog('holding')}><Plus aria-hidden="true" />持倉快照</Button><Button size="sm" variant="outline" onClick={() => setDialog('quote')}><Plus aria-hidden="true" />市場報價</Button><Button size="sm" variant="outline" onClick={() => setDialog('fx')}><Plus aria-hidden="true" />匯率</Button></div></section>

    <section className="space-y-3"><div className="flex items-center gap-2"><BadgeDollarSign className="size-5 text-primary" aria-hidden="true" /><h2 className="font-semibold">最新持倉與估值</h2><span className="text-sm tabular-nums text-muted-foreground">{positions.length}</span></div>
      {positions.length ? <div className="divide-y rounded-md border">{positions.map((position) => <article key={position.holding_key} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,auto)] sm:items-center"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-medium">{displayInstrumentName(position.instrument_name)}</h3><Badge variant={position.valuation_status === 'current' ? 'default' : 'outline'}>{STATUS[position.valuation_status] || '估值待確認'}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{displayInstrumentSymbol(position.symbol)} · {position.quantity_decimal} 單位 · 持倉日 {position.as_of_date}</p><p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><Clock3 className="size-3" aria-hidden="true" />報價 {position.quote?.as_of_date || '未提供'} · 匯率 {position.fx?.as_of_date || (position.quote_currency === position.base_currency ? '不需要' : '未提供')}</p></div><div className="sm:text-right"><p className="font-mono text-base font-semibold tabular-nums">{formatMoneyMinor(position.base_value_minor, position.base_currency, { emptyLabel: '尚無估值' })}</p><p className="text-xs text-muted-foreground">來源報告 {formatMoneyMinor(position.reported_market_value_minor, position.currency, { emptyLabel: '尚無估值' })}</p></div></article>)}</div> : <div className="rounded-md border border-dashed px-5 py-10 text-center"><p className="font-medium">尚無持倉快照</p><p className="mt-1 text-sm text-muted-foreground">先建立投資帳戶與工具，再手動新增持倉，或由 AI 依券商來源走預覽／確認流程。</p></div>}
    </section>
    <EntryDialog kind={dialog} open={Boolean(dialog)} accounts={inventory.accounts || []} instruments={activeInstruments} onOpenChange={(open) => !open && setDialog(null)} onSaved={refresh} />
  </div>;
}

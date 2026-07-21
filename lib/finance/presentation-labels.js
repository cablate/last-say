const CURRENCY_LABELS = Object.freeze({
  TWD: "新台幣",
  USD: "美元",
  JPY: "日圓",
  CNY: "人民幣",
  EUR: "歐元",
  GBP: "英鎊",
});

const POSITION_LABELS = Object.freeze({
  cash: "現金",
  bank: "銀行存款",
  e_wallet: "電子錢包",
  investment: "投資部位",
  receivable: "應收款項",
  private_receivable: "私人應收款",
  fixed_asset: "固定資產",
  credit_card: "信用卡負債",
  loan: "貸款負債",
  payable: "應付款項",
  equity: "權益",
  derived_net_worth: "計算後淨資產",
});

const STATUS_LABELS = Object.freeze({
  current: "最新",
  missing: "缺少餘額",
  stale: "資料過期",
  conflicted: "有衝突",
  needs_review: "待確認",
  known: "已知",
  missing_data: "缺少資料",
  complete: "完整",
  partial: "部分完成",
  unmapped: "待分類",
  unreconciled: "尚未對平",
  empty: "無資料",
  proposed: "待確認",
  confirmed: "已確認",
  rejected: "已拒絕",
  active: "使用中",
  inactive: "已停用",
  open: "待處理",
  resolved: "已處理",
  superseded: "已取代",
});

const AUTHORITY_LABELS = Object.freeze({
  official: "官方資料",
  institution_export: "銀行／券商匯出",
  user_confirmed: "本人確認",
  ai_researched: "AI 查證",
  ai_inferred: "AI 推定",
  imported: "匯入資料",
});

const REVIEW_STATE_LABELS = Object.freeze({
  reviewed: "已審閱",
  pending: "待審閱",
  unreviewed: "未審閱",
  confirmed: "已確認",
  rejected: "已拒絕",
});

const RESOURCE_TYPE_LABELS = Object.freeze({
  account: "帳戶",
  account_balance_snapshot: "帳戶餘額快照",
  credit_card_profile: "信用卡資料",
  credit_card_statement: "信用卡帳單",
  identity_merge: "身分合併",
  investment_holding_valuation: "投資估值",
  liability_profile: "負債資料",
  source: "來源證據",
  valued_item: "人工估值項目",
  valued_item_valuation: "人工估值快照",
  transfer_match: "轉帳配對",
  reimbursement_match: "報銷配對",
  commitment: "固定收支",
  scope_attestation: "資料範圍確認",
  scope_confirmation: "資料範圍確認",
  source_conflict: "來源衝突",
  identity_merge: "身分合併",
});

const TASK_KIND_LABELS = Object.freeze({
  account_identity_conflict: "帳戶身分衝突",
  duplicate_context: "重複資料情境",
  source_conflict: "來源衝突",
  valuation_review: "估值待審",
});

const SOURCE_KIND_LABELS = Object.freeze({
  bank_statement: "銀行帳戶明細",
  bank_export: "銀行匯出檔",
  credit_card_statement: "信用卡帳單",
  brokerage_statement: "券商對帳單",
  investment_statement: "投資資料",
  manual_entry: "手動輸入",
  user_input: "本人提供資料",
  imported_file: "匯入檔案",
  web_research: "網路查證",
});

const BALANCE_KIND_LABELS = Object.freeze({
  ledger: "帳面餘額",
  available: "可用餘額",
  statement: "帳單餘額",
  cash: "現金餘額",
});

const EVENT_KIND_LABELS = Object.freeze({
  loan_payment: "貸款還款",
  credit_card_payment: "信用卡繳款",
  recurring_commitment: "固定義務",
  rent: "房租",
  student_loan_payment: "學貸還款",
});

const CADENCE_LABELS = Object.freeze({
  monthly: "每月",
  yearly: "每年",
  weekly: "每週",
  quarterly: "每季",
  one_time: "一次性",
});

const COMMITMENT_KIND_LABELS = Object.freeze({
  family_support: "家庭支援",
  rent: "房租",
  loan_payment: "貸款還款",
  student_loan: "學貸",
  credit_card_payment: "信用卡繳款",
  subscription: "訂閱服務",
  other: "其他固定義務",
});

const LIABILITY_KIND_LABELS = Object.freeze({
  personal_loan: "個人信貸",
  bank_loan: "銀行貸款",
  student_loan: "學貸",
  mortgage: "房貸",
  credit_card: "信用卡負債",
  payable: "應付款項",
  other: "其他負債",
  amortizing_loan: "分期貸款",
});

const INSTRUMENT_TYPE_LABELS = Object.freeze({
  stock: "股票",
  etf: "ETF",
  mutual_fund: "共同基金",
  bond: "債券",
  cash_equivalent: "約當現金",
  simple_crypto: "加密資產",
  quoted_asset: "其他有報價資產",
});

const READINESS_GAP_LABELS = Object.freeze({
  missing_scope_attestation: "尚未確認這個分析範圍包含哪些帳戶。",
  confirm_or_update_scope_inventory: "尚未確認這個分析範圍包含哪些帳戶。",
  missing_balance_snapshot: "部分帳戶缺少指定日期的餘額快照。",
  missing_beginning_cash_snapshot: "部分帳戶缺少期初現金餘額。",
  missing_investment_position_detail: "部分投資缺少工具層級持倉明細。",
  missing_liability_balance: "部分負債缺少目前餘額。",
  incomplete_debt_service_schedule: "部分負債缺少還款排程。",
  reconciliation_not_ready: "部分現金流尚未完成對帳。",
  separate_context_required: "這項分析需要另外建立專用資料範圍。",
});

const VALUATION_METHOD_LABELS = Object.freeze({
  reported_market_value: "已提供市值",
  quantity_times_market_quote: "數量 × 市價",
  manual: "人工估值",
});

function hasCjk(value) {
  return /[\u3400-\u9fff]/.test(String(value || ""));
}

function looksInternal(value) {
  return /[a-z]+_[a-z_]+/i.test(String(value || ""));
}

export function displayCurrency(currency) {
  return CURRENCY_LABELS[currency] || "外幣";
}

export function displayInstitution(institution) {
  if (!institution) return "未指定機構";
  return hasCjk(institution) ? institution : "其他機構";
}

export function displayInstrumentName(name) {
  if (!name) return "未命名投資工具";
  return hasCjk(name) ? name : "其他投資工具";
}

export function displayInstrumentSymbol(symbol) {
  if (!symbol) return "無代號";
  return /-AGG$/i.test(symbol) ? "總額快照" : symbol;
}

export function displayStatus(status) {
  return STATUS_LABELS[status] || "待確認";
}

export function displayAuthority(authority) {
  return AUTHORITY_LABELS[authority] || "來源資料";
}

export function displayReviewState(state) {
  return REVIEW_STATE_LABELS[state] || "待審閱";
}

export function displayResourceType(type) {
  return RESOURCE_TYPE_LABELS[type] || "資料項目";
}

export function displayTaskKind(kind) {
  return TASK_KIND_LABELS[kind] || "待審工作";
}

export function displaySourceKind(kind) {
  return SOURCE_KIND_LABELS[kind] || "來源資料";
}

export function displayBalanceKind(kind) {
  return BALANCE_KIND_LABELS[kind] || "餘額資料";
}

export function displayEventKind(kind) {
  return EVENT_KIND_LABELS[kind] || "固定義務";
}

export function displayCadence(cadence) {
  return CADENCE_LABELS[cadence] || "週期未標示";
}

export function displayCommitmentKind(kind) {
  return COMMITMENT_KIND_LABELS[kind] || "固定義務";
}

export function displayLiabilityKind(kind) {
  return LIABILITY_KIND_LABELS[kind] || "其他負債";
}

export function displayInstrumentType(type) {
  return INSTRUMENT_TYPE_LABELS[type] || "投資工具";
}

export function displayReadinessGap(gap) {
  return READINESS_GAP_LABELS[gap] || "這項資料仍有缺口。";
}

export function displayValuationMethod(method) {
  return VALUATION_METHOD_LABELS[method] || "估值方式未標示";
}

export function displayPositionType(lineOrKind) {
  const kind = typeof lineOrKind === "string"
    ? lineOrKind
    : lineOrKind?.account_kind || lineOrKind?.item_type || lineOrKind?.line || "";
  const normalized = String(kind).replace(/^valued_item:/, "");
  return POSITION_LABELS[normalized] || "其他財務項目";
}

export function displayAccountLabel(lineOrLabel, accountKind) {
  if (typeof lineOrLabel === "object" && lineOrLabel?.line === "derived_net_worth") {
    return "淨資產（資產扣除負債）";
  }
  const raw = typeof lineOrLabel === "string"
    ? lineOrLabel
    : lineOrLabel?.label || lineOrLabel?.display_name;
  const kind = accountKind || lineOrLabel?.account_kind;
  if (!raw) return `${displayPositionType(kind)}（未命名）`;
  if (hasCjk(raw) && !looksInternal(raw)) return raw;
  if (kind === "investment") return "投資部位（未命名）";
  if (kind === "bank" || kind === "cash") return "銀行存款（未命名）";
  if (kind === "loan") return "貸款負債（未命名）";
  if (kind === "credit_card") return "信用卡負債（未命名）";
  return `${displayPositionType(kind)}（未命名）`;
}

export function displayPositionMeta(line) {
  const type = displayPositionType(line);
  if (line?.line === "derived_net_worth") return "資產合計 − 負債合計";
  const currency = line?.native_currency || line?.base_currency;
  return currency ? `${type} · ${displayCurrency(currency)}` : type;
}

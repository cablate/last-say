// 根路徑與 /control 共用同一個日常財務儀表板，避免出現兩套互相競爭的總覽。
import FinancialDashboard from "@/components/financial-control/FinancialDashboard"

export default function Page() {
  return <FinancialDashboard />
}

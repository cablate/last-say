import { NextResponse } from "next/server";
import { getIncomeStatement } from "@/lib/queries/reports/income-statement";
import { financeErrorResponse } from "@/lib/finance/http";

export async function GET(request) {
  try {
    const data = getIncomeStatement(request.nextUrl.searchParams);
    return NextResponse.json(data);
  } catch (err) {
    const response = financeErrorResponse(err);
    return NextResponse.json(response.body, { status: response.status });
  }
}

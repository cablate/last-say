import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/api-helpers";
import { getBalanceHistory } from "@/lib/queries";

export async function GET() {
  try {
    const data = getBalanceHistory();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}

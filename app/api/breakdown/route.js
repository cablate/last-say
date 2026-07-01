import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/api-helpers";
import { getBreakdown } from "@/lib/queries";

export async function GET(request) {
  try {
    const params = request.nextUrl.searchParams;
    const data = getBreakdown(params);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}

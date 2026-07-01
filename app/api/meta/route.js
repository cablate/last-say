import { NextResponse } from "next/server";
import { safeErrorMessage } from "@/lib/api-helpers";
import { getMeta } from "@/lib/queries";

export async function GET() {
  try {
    const data = getMeta();
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err) },
      { status: 500 }
    );
  }
}

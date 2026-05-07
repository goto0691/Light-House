import { NextResponse } from "next/server";

import { updateCareerEntryProperties } from "@/lib/server/life-ops";

type PropertiesRequest = {
  organization?: string;
  role?: string;
  category?: string;
  startDate?: string;
  endDate?: string | null;
  description?: string;
};

export async function POST(request: Request, context: { params: Promise<{ careerId: string }> }) {
  try {
    const { careerId } = await context.params;
    const body = (await request.json()) as PropertiesRequest;
    const snapshot = await updateCareerEntryProperties(careerId, body);
    return NextResponse.json({ snapshot });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Career properties update failed." }, { status: 500 });
  }
}

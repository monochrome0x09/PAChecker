import { NextResponse } from "next/server";
import { listDueNotifications } from "@/lib/db/notifications";
import { isValidAssessmentDate } from "@/lib/db/assessments";
export const runtime = "nodejs";
export async function GET(request: Request) { const date=new URL(request.url).searchParams.get("date") ?? new Date().toISOString().slice(0,10); if(!isValidAssessmentDate(date)) return NextResponse.json({error:"date must be a real calendar date in YYYY-MM-DD format"},{status:400}); try{return NextResponse.json(await listDueNotifications(date));}catch(e){console.error(e);return NextResponse.json({error:"Notification request failed"},{status:500});}}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
    const supabase = await createClient();

    const { data, error } = await supabase
        .from("connection_test")
        .select("*")
        .limit(1);

    if (error) {
        console.error("Supabase connection test failed:", error);

        return NextResponse.json(
            {
                success: false,
                error: error.message,
            },
            { status: 500 }
        );
    }

    return NextResponse.json({
        success: true,
        message: "LegacyVault AI → Supabase PostgreSQL connection working!",
        data,
    });
}
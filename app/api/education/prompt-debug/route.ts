import { NextRequest, NextResponse } from "next/server";
import { analyzeTemplates } from "@/lib/prompt-debugger";

export async function GET(req: NextRequest) {
  try {
    // Run the template analyzer
    const errors = analyzeTemplates();
    
    // Return the results
    return NextResponse.json({ 
      success: true, 
      errors: errors || []
    });
  } catch (error: any) {
    console.error("Error analyzing templates:", error);
    return NextResponse.json({ 
      success: false, 
      error: error.message || "Failed to analyze templates" 
    }, { status: 500 });
  }
} 
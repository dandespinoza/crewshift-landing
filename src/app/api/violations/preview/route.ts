import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const PREVIEW_SYSTEM_PROMPT = `You are an expert NYC building compliance analyst. You extract key information from violation notices and provide a high-level assessment.

You have deep knowledge of all NYC agencies: DOB, HPD, DEP, FDNY, ECB/OATH, DOT, DSNY.

Extract and assess the violation, then respond with a concise preview. This is NOT the full resolution — just enough for the property owner to understand what they're dealing with.

RESPOND WITH VALID JSON ONLY. No markdown, no explanation, no preamble.

Response schema:
{
  "property": {
    "address": string | null,
    "borough": string | null
  },
  "violation": {
    "agency": string,
    "title": string,
    "code_section": string | null,
    "plain_english": string,
    "severity": "CRITICAL" | "MAJOR" | "MODERATE" | "MINOR",
    "penalty_amount": number | null,
    "compliance_deadline": string | null,
    "hearing_date": string | null
  },
  "assessment": {
    "urgency": "IMMEDIATE" | "URGENT" | "STANDARD" | "LOW",
    "what_needs_to_happen": string,
    "what_happens_if_ignored": string,
    "estimated_cost_range": string,
    "estimated_timeline": string,
    "needs_licensed_professional": boolean
  },
  "permits_likely_needed": [
    {
      "name": string,
      "agency": string,
      "description": string
    }
  ],
  "document_quality": "clear" | "readable" | "partial" | "poor",
  "is_violation_document": boolean,
  "confidence": number
}

CRITICAL RULES:
- "is_violation_document" must be true ONLY if the uploaded image is clearly a violation notice, citation, summons, inspection report, compliance order, or similar official agency document. If it is a random photo, selfie, screenshot, meme, receipt, or anything unrelated to building/property violations, set this to false.
- "confidence" is a number from 0 to 100 representing how confident you are that this is a real violation document. If below 75, set "is_violation_document" to false.
- If "is_violation_document" is false, you may leave all other fields as null/empty — they will not be used.

IMPORTANT:
- "plain_english" must explain the violation as if talking to someone who has never dealt with the city. No jargon. 2-3 sentences max.
- "what_needs_to_happen" is a HIGH-LEVEL summary only. Do NOT list specific steps, permit types, or professional license types. Keep it to 1-2 sentences. Example: "You'll need to get a permit for the work that was done and show proof of correction to the city."
- "what_happens_if_ignored" should be scary but honest. Mention fines, liens, default judgments if applicable.
- "estimated_cost_range" as a simple string like "$2,000 - $8,000"
- "estimated_timeline" as a simple string like "4-8 weeks"
- If the document has multiple violations, pick the MOST SEVERE one for the preview.
- "permits_likely_needed" should list 1-4 permits/filings that will likely be required to resolve this violation. Use real NYC permit names (e.g. "PW1 - Plumbing Work Permit", "ALT1 - Alteration Application", "DOB Correction Certificate"). Include the filing agency and a one-line description of what it is.`;

const MEDIA_TYPE_MAP: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "application/pdf": "application/pdf",
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const userContext = formData.get("context") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided." },
        { status: 400 }
      );
    }

    const mediaType = MEDIA_TYPE_MAP[file.type];
    if (!mediaType) {
      return NextResponse.json(
        { error: `Unsupported file type: ${file.type}. Accepted: PDF, JPG, PNG, WebP.` },
        { status: 400 }
      );
    }

    if (file.size > 52428800) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 50MB." },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    // Build the user message — image + optional context from user
    const userContent: Anthropic.Messages.ContentBlockParam[] = [
      {
        type: "image",
        source: {
          type: "base64",
          media_type: mediaType,
          data: base64Data,
        },
      },
      {
        type: "text",
        text: userContext
          ? `Extract and assess this violation document. The user provided this additional context: "${userContext}"`
          : "Extract and assess this violation document.",
      },
    ];

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: PREVIEW_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        {
          role: "user",
          content: userContent,
        },
      ],
    });

    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    let extractedData;
    try {
      // Strip markdown code fences if present
      const cleaned = responseText.replace(/^```json\s*/, "").replace(/\s*```$/, "");
      extractedData = JSON.parse(cleaned);
    } catch {
      return NextResponse.json(
        { error: "Analysis failed. Please try with a clearer image." },
        { status: 500 }
      );
    }

    // Check if the document is actually a violation
    if (!extractedData.is_violation_document || (extractedData.confidence && extractedData.confidence < 75)) {
      return NextResponse.json(
        { error: "This doesn't look like a violation notice. Please upload a violation, citation, summons, or inspection report from a city agency and try again." },
        { status: 400 }
      );
    }

    // Set cookie to mark that free trial has been used
    const response = NextResponse.json({
      success: true,
      preview: extractedData,
    });

    response.cookies.set("cs_free_used", "1", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 60 * 60 * 24 * 365, // 1 year
      path: "/",
    });

    return response;
  } catch (error: unknown) {
    console.error("Preview extraction error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Analysis failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

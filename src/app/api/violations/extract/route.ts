import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase";
import {
  VIOLATION_EXTRACTION_SYSTEM_PROMPT,
  VIOLATION_EXTRACTION_FEW_SHOT_EXAMPLES,
} from "@/lib/prompts/violation-extraction";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Map file extensions to Claude-compatible media types
const MEDIA_TYPE_MAP: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp" | "application/pdf"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "application/pdf": "application/pdf",
};

export async function POST(request: NextRequest) {
  try {
    // Get the uploaded file from the form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided. Send a file in the 'file' field." },
        { status: 400 }
      );
    }

    // Validate file type
    const mediaType = MEDIA_TYPE_MAP[file.type];
    if (!mediaType) {
      return NextResponse.json(
        {
          error: `Unsupported file type: ${file.type}. Accepted: PDF, JPG, PNG, WebP.`,
        },
        { status: 400 }
      );
    }

    // Validate file size (50MB max)
    if (file.size > 52428800) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 50MB." },
        { status: 400 }
      );
    }

    // Read file into buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const base64Data = buffer.toString("base64");

    // Generate unique filename
    const timestamp = Date.now();
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const storagePath = `uploads/${timestamp}_${sanitizedName}`;

    // Store the original document in Supabase Storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from("violations")
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("Storage upload error:", uploadError);
      return NextResponse.json(
        { error: "Failed to store document." },
        { status: 500 }
      );
    }

    // Get the public URL for the stored document
    const { data: urlData } = supabaseAdmin.storage
      .from("violations")
      .getPublicUrl(storagePath);

    // Send to Claude vision API with the extraction prompt
    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      system: [
        {
          type: "text",
          text: VIOLATION_EXTRACTION_SYSTEM_PROMPT,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        // Few-shot examples (cached)
        ...VIOLATION_EXTRACTION_FEW_SHOT_EXAMPLES.map((example) => ({
          role: example.role,
          content: example.content,
        })),
        // The actual document to extract from
        {
          role: "user",
          content: [
            {
              type: "image" as const,
              source: {
                type: "base64" as const,
                media_type: mediaType,
                data: base64Data,
              },
            },
            {
              type: "text" as const,
              text: "Extract all violation data from this document. Return valid JSON only.",
            },
          ],
        },
      ],
    });

    // Parse Claude's response
    const responseText =
      message.content[0].type === "text" ? message.content[0].text : "";

    let extractedData;
    try {
      extractedData = JSON.parse(responseText);
    } catch {
      return NextResponse.json(
        {
          error: "AI extraction returned invalid format. Please try again.",
          raw_response: responseText,
        },
        { status: 500 }
      );
    }

    // Return the extracted data with metadata
    return NextResponse.json({
      success: true,
      document: {
        original_filename: file.name,
        storage_path: storagePath,
        file_type: file.type,
        file_size: file.size,
        uploaded_at: new Date().toISOString(),
      },
      extraction: extractedData,
      usage: {
        input_tokens: message.usage.input_tokens,
        output_tokens: message.usage.output_tokens,
        model: "claude-sonnet-4-20250514",
        cached: message.usage.cache_creation_input_tokens !== undefined,
      },
    });
  } catch (error: unknown) {
    console.error("Extraction error:", error);

    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    return NextResponse.json(
      { error: `Extraction failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}

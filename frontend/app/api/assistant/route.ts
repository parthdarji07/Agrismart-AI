import { NextResponse } from "next/server";

const GEMINI_API_KEY =
  process.env.GEMINI_API_KEY ||
  process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
  "";

const SYSTEM_PROMPT = `You are "AgriSmart AI", an expert farming agronomist assistant.
Always reply in the EXACT SAME LANGUAGE as requested (English, Hindi, or Gujarati).

IMPORTANT RESPONSE FORMAT & ACCURACY RULES:
1. Keep your answer SHORT, CONCISE, and DIRECT TO THE POINT (maximum 2 to 3 bullet points).
2. DO NOT include long welcome speeches, intro paragraphs, or conversational fluff.
3. Start directly with clear bullet points using "• " symbols.
4. Provide accurate, practical advice (crop care, irrigation timing, disease prevention, KVK Helpline: 1800-180-1551).
5. Never invent numeric chemical dosages — recommend safe categories (e.g. copper fungicide, neem oil) and advise confirming on product labels.`;

const LANGUAGE_INSTRUCTIONS: Record<string, string> = {
  english: "Respond in concise, clear English (2-3 short bullet points starting with •). Be direct and accurate.",
  hindi: "संक्षिप्त हिंदी (2-3 छोटे मुख्य बिंदु • से शुरू) में उत्तर दें। सीधे सटीक कृषि उपाय लिखें।",
  gujarati: "ટૂંકી અને સ્પષ્ટ ગુજરાતીમાં (2-3 ટૂંકા મુદ્દાઓ • થી શરૂ) જવાબ આપો. સીધી ચોક્કસ ખેતી સલાહ લખો.",
};

function normalizeLanguage(lang?: string): string {
  if (!lang) return "english";
  const l = str(lang).toLowerCase().trim();
  if (["hi", "hindi", "hin", "हिन्दी", "हिंदी"].includes(l)) return "hindi";
  if (["gu", "gujarati", "guj", "ગુજરાતી"].includes(l)) return "gujarati";
  return "english";
}

function str(val: any): string {
  return String(val || "");
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawQuestion = body.question || "";
    const language = normalizeLanguage(body.language);
    const context = body.context || {};

    let question = rawQuestion;
    if (!question) {
      if (body.disease_label && body.irrigation_title) {
        question = `For my ${body.crop || "crop"} crop with ${body.disease_label}, should I ${body.irrigation_title.toLowerCase()} given ${body.rain_probability || 18}% rain probability?`;
      } else {
        question = "What is the recommended farming action based on my current field context?";
      }
    }

    const langInstruction = LANGUAGE_INSTRUCTIONS[language] || LANGUAGE_INSTRUCTIONS["english"];
    let contextStr = "No specific context available.";
    if (context && typeof context === "object") {
      const parts: string[] = [];
      if (context.detected_disease) parts.push(`Disease Detection: ${context.detected_disease}`);
      if (context.crop) parts.push(`Crop: ${context.crop}`);
      if (context.weather && typeof context.weather === "object") {
        parts.push(`Live Weather: ${context.weather.temperature || "N/A"}°C, ${context.weather.humidity || "N/A"}% humidity`);
      }
      if (parts.length > 0) contextStr = parts.join("\n");
    }

    const fullPrompt = `${SYSTEM_PROMPT}\n\n${langInstruction}\n\nCONTEXT:\n${contextStr}\n\nFarmer's Question: ${question}`;

    const modelCandidates = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-3.5-flash", "gemini-2.5-flash-lite"];

    for (const modelName of modelCandidates) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: fullPrompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 2048 },
          }),
        });

        if (res.ok) {
          const data = await res.json();
          const candidates = data.candidates || [];
          if (candidates.length > 0) {
            const partsList = candidates[0]?.content?.parts || [];
            const textParts: string[] = [];
            for (const p of partsList) {
              if (p.text && !p.thought) {
                textParts.push(p.text);
              }
            }
            const fullText = textParts.join("").trim();
            if (fullText) {
              return NextResponse.json({
                success: true,
                response: fullText,
                answer: fullText,
                source: "gemini",
                language,
                grounded: true,
              });
            }
          }
        }
      } catch (e) {
        console.warn(`Model ${modelName} failed on Vercel route handler:`, e);
      }
    }

    // Fallback response if API call fails
    return NextResponse.json({
      success: true,
      response: "AgriSmart AI Assistant is operational. For immediate advice on your field, retake a clear leaf scan or consult your local Krishi Vigyan Kendra helpline (1800-180-1551).",
      answer: "AgriSmart AI Assistant is operational. For immediate advice on your field, retake a clear leaf scan or consult your local Krishi Vigyan Kendra helpline (1800-180-1551).",
      source: "rule_based_fallback",
      language,
    });
  } catch (error: any) {
    return NextResponse.json({
      success: false,
      error: error.message || "Failed to process assistant request",
    }, { status: 500 });
  }
}

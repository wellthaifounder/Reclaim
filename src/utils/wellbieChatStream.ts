import { logError } from "@/utils/errorHandler";
import { supabase } from "@/integrations/supabase/client";

type Message = { role: "user" | "assistant"; content: string };

interface BillAnalysisContext {
  success: boolean;
  metadata?: {
    provider_name?: { value: string; confidence: number };
    total_amount?: { value: number; confidence: number };
    service_date?: { value: string; confidence: number };
    bill_date?: { value: string; confidence: number };
    category?: { value: string; confidence: number };
    invoice_number?: { value: string; confidence: number };
  };
  totalPotentialSavings?: number;
  errorsFound?: number;
  confidenceScore?: number;
  warnings?: string[];
}

interface StreamChatOptions {
  messages: Message[];
  onDelta: (deltaText: string) => void;
  onDone: () => void;
  onError?: (error: Error) => void;
  context?: {
    page?: string;
    expenseCount?: number;
    billAnalysis?: BillAnalysisContext;
    invoiceId?: string;
  };
}

export async function streamWellbieChat({
  messages,
  onDelta,
  onDone,
  onError,
  context,
}: StreamChatOptions) {
  const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/wellbie-chat`;

  try {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error("Invalid or expired session");
    }

    const response = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ messages, context }),
    });

    if (!response.ok) {
      const errorData = await response
        .json()
        .catch(() => ({ error: "Unknown error" }));
      throw new Error(errorData.error || `HTTP ${response.status}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let streamDone = false;

    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;

      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") {
          streamDone = true;
          break;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as
            string | undefined;
          if (content) onDelta(content);
        } catch {
          textBuffer = line + "\n" + textBuffer;
          break;
        }
      }
    }

    // Flush remaining buffer
    if (textBuffer.trim()) {
      for (let raw of textBuffer.split("\n")) {
        if (!raw || raw.startsWith(":")) continue;
        if (!raw.startsWith("data: ")) continue;
        const jsonStr = raw.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content as
            string | undefined;
          if (content) onDelta(content);
        } catch {
          /* ignore */
        }
      }
    }

    onDone();
  } catch (error) {
    logError("Stream error", error);
    if (onError) {
      onError(error instanceof Error ? error : new Error("Stream failed"));
    }
  }
}

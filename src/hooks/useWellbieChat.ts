import { useState, useCallback, useEffect } from "react";
import { streamWellbieChat } from "@/utils/wellbieChatStream";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

type Message = { role: "user" | "assistant"; content: string };
type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

interface BillAnalysisResult {
  success: boolean;
  billReviewId?: string;
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

export const useWellbieChat = () => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  const loadConversations = useCallback(async () => {
    const { data, error } = await supabase
      .from("wellbie_conversations")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      logError("Error loading conversations:", error);
    } else {
      setConversations(data || []);
    }
  }, []);

  const loadMessages = useCallback(async (conversationId: string) => {
    const { data, error } = await supabase
      .from("wellbie_messages")
      .select("*")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true });

    if (error) {
      logError("Error loading messages:", error);
    } else {
      setMessages(
        data?.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })) || [],
      );
    }
  }, []);

  // Load conversations on mount
  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Load messages when conversation changes
  useEffect(() => {
    if (currentConversationId) {
      loadMessages(currentConversationId);
    } else {
      setMessages([]);
    }
  }, [currentConversationId, loadMessages]);

  const createNewConversation = async (firstMessage: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Please sign in to save conversations");
      return null;
    }

    const title =
      firstMessage.slice(0, 50) + (firstMessage.length > 50 ? "..." : "");
    const { data, error } = await supabase
      .from("wellbie_conversations")
      .insert({ user_id: user.id, title })
      .select()
      .single();

    if (error) {
      logError("Error creating conversation:", error);
      return null;
    }

    await loadConversations();
    return data.id;
  };

  const saveMessage = async (
    conversationId: string,
    role: "user" | "assistant",
    content: string,
  ) => {
    await supabase.from("wellbie_messages").insert({
      conversation_id: conversationId,
      role,
      content,
    });

    // Update conversation updated_at
    await supabase
      .from("wellbie_conversations")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", conversationId);
  };

  // Upload file to Supabase storage and create receipt record
  const uploadFileForAnalysis = async (
    file: File,
    userId: string,
  ): Promise<{ receiptId: string; invoiceId: string } | null> => {
    try {
      // Create a temporary invoice for this bill
      const { data: invoice, error: invoiceError } = await supabase
        .from("invoices")
        .insert({
          user_id: userId,
          vendor: "Pending Analysis",
          amount: 0,
          date: new Date().toISOString().split("T")[0],
          category: "Medical Services",
          // Workstream B: is_hsa_eligible is derived from eligibility_state.
          // A placeholder row created for analysis has made no eligibility
          // determination, so it stays 'unknown'.
          eligibility_state: "unknown",
        })
        .select()
        .single();

      if (invoiceError) {
        logError("Error creating invoice:", invoiceError);
        return null;
      }

      // Upload file to storage
      const timestamp = Date.now();
      const ext = file.name.split(".").pop() || "jpg";
      const filePath = `${userId}/${invoice.id}/medical_bill_${timestamp}.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from("receipts")
        .upload(filePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        logError("Error uploading file:", uploadError);
        // Clean up invoice
        await supabase.from("invoices").delete().eq("id", invoice.id);
        return null;
      }

      // Create receipt record
      const { data: receipt, error: receiptError } = await supabase
        .from("receipts")
        .insert({
          user_id: userId,
          invoice_id: invoice.id,
          file_path: filePath,
          file_type: file.type,
          document_type: "invoice",
        })
        .select()
        .single();

      if (receiptError) {
        logError("Error creating receipt:", receiptError);
        return null;
      }

      return { receiptId: receipt.id, invoiceId: invoice.id };
    } catch (err) {
      logError("Error in uploadFileForAnalysis:", err);
      return null;
    }
  };

  // Analyze uploaded bill
  const analyzeBill = async (
    invoiceId: string,
    receiptId: string,
  ): Promise<BillAnalysisResult | null> => {
    try {
      const { data, error } = await supabase.functions.invoke(
        "analyze-medical-bill",
        {
          body: { invoiceId, receiptId },
        },
      );

      if (error) {
        logError("Error analyzing bill:", error);
        return null;
      }

      return data as BillAnalysisResult;
    } catch (err) {
      logError("Error in analyzeBill:", err);
      return null;
    }
  };

  const sendMessage = useCallback(
    async (userMessage: string, attachments?: File[]) => {
      if (
        (!userMessage.trim() && (!attachments || attachments.length === 0)) ||
        isLoading
      )
        return;

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Please sign in to use Wellbie");
        return;
      }

      let conversationId = currentConversationId;

      // Create new conversation if none exists
      if (!conversationId) {
        conversationId = await createNewConversation(
          userMessage || "Medical bill analysis",
        );
        if (conversationId) {
          setCurrentConversationId(conversationId);
        }
      }

      // Handle file attachments
      let analysisResult: BillAnalysisResult | null = null;
      let uploadedInvoiceId: string | null = null;

      if (attachments && attachments.length > 0) {
        // Show uploading message
        const uploadMessage =
          attachments.length === 1
            ? `📄 Uploading ${attachments[0].name}...`
            : `📄 Uploading ${attachments.length} files...`;

        const newUserMessage: Message = {
          role: "user",
          content: userMessage || uploadMessage,
        };
        setMessages((prev) => [...prev, newUserMessage]);
        setIsLoading(true);
        setError(null);

        // Save user message
        if (conversationId) {
          await saveMessage(
            conversationId,
            "user",
            userMessage || uploadMessage,
          );
        }

        // Add analyzing message
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "🔍 Analyzing your medical bill..." },
        ]);

        // Upload and analyze first file (for now, we'll handle one file at a time)
        const file = attachments[0];
        const uploadResult = await uploadFileForAnalysis(file, user.id);

        if (uploadResult) {
          uploadedInvoiceId = uploadResult.invoiceId;
          analysisResult = await analyzeBill(
            uploadResult.invoiceId,
            uploadResult.receiptId,
          );

          // Update the invoice with extracted metadata
          if (analysisResult?.success && analysisResult.metadata) {
            const { metadata } = analysisResult;
            await supabase
              .from("invoices")
              .update({
                vendor: metadata.provider_name?.value || "Unknown Provider",
                amount: metadata.total_amount?.value || 0,
                date:
                  metadata.service_date?.value ||
                  new Date().toISOString().split("T")[0],
                category: metadata.category?.value || "Medical Services",
              })
              .eq("id", uploadResult.invoiceId);
          }
        }
      } else {
        const newUserMessage: Message = { role: "user", content: userMessage };
        setMessages((prev) => [...prev, newUserMessage]);
        setIsLoading(true);
        setError(null);

        // Save user message
        if (conversationId) {
          await saveMessage(conversationId, "user", userMessage);
        }
      }

      let assistantContent = "";
      const updateAssistant = (chunk: string) => {
        assistantContent += chunk;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === "assistant") {
            return prev.map((m, i) =>
              i === prev.length - 1 ? { ...m, content: assistantContent } : m,
            );
          }
          return [...prev, { role: "assistant", content: assistantContent }];
        });
      };

      try {
        await streamWellbieChat({
          messages: [
            ...messages,
            {
              role: "user",
              content: userMessage || "I'm uploading a medical bill.",
            },
          ],
          onDelta: updateAssistant,
          onDone: async () => {
            setIsLoading(false);
            // Save assistant message
            if (conversationId && assistantContent) {
              await saveMessage(conversationId, "assistant", assistantContent);
              await loadConversations(); // Refresh list
            }
          },
          onError: (err) => {
            setError(err.message);
            setIsLoading(false);
          },
          context: {
            page: location.pathname,
            billAnalysis: analysisResult || undefined,
            invoiceId: uploadedInvoiceId || undefined,
          },
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to send message");
        setIsLoading(false);
      }
    },
    [
      messages,
      isLoading,
      location.pathname,
      currentConversationId,
      toast,
      loadConversations,
    ],
  );

  const switchConversation = (conversationId: string) => {
    setCurrentConversationId(conversationId);
  };

  const startNewConversation = () => {
    setCurrentConversationId(null);
    setMessages([]);
  };

  const deleteConversation = async (conversationId: string) => {
    await supabase
      .from("wellbie_conversations")
      .delete()
      .eq("id", conversationId);
    if (currentConversationId === conversationId) {
      setCurrentConversationId(null);
      setMessages([]);
    }
    await loadConversations();
  };

  return {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    error,
    sendMessage,
    switchConversation,
    startNewConversation,
    deleteConversation,
  };
};

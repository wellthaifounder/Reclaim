import { useEffect, useRef, useState } from "react";
import { WellbieAvatar } from "./WellbieAvatar";
import { Button } from "./ui/button";
import { Textarea } from "./ui/textarea";
import {
  X,
  Minimize2,
  Send,
  MessageSquarePlus,
  Trash2,
  Menu,
  Paperclip,
  FileText,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "react-router-dom";
import { ScrollArea } from "./ui/scroll-area";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "./ui/sheet";
import { logError } from "@/utils/errorHandler";

type Message = { role: "user" | "assistant"; content: string };
type Conversation = {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
};

type FileAttachment = {
  file: File;
  preview?: string;
  status: "pending" | "uploading" | "analyzing" | "complete" | "error";
  error?: string;
};

interface WellbieChatPanelProps {
  conversations: Conversation[];
  currentConversationId: string | null;
  messages: Message[];
  isLoading: boolean;
  error: string | null;
  onSendMessage: (message: string, attachments?: File[]) => void;
  onSwitchConversation: (id: string) => void;
  onStartNew: () => void;
  onDeleteConversation: (id: string) => void;
  onClose: () => void;
  onMinimize: () => void;
}

const quickActionsByPage: Record<string, string[]> = {
  "/dashboard": ["What should I do next?", "Explain my savings potential"],
  "/expenses/new": ["What documents do I need?", "Is this HSA eligible?"],
  "/reports": ["How can I optimize my strategy?", "Explain these charts"],
  "/substantiation": ["When should I reimburse?", "What's the tax impact?"],
  "/payment-methods": ["Which card should I use?", "How do rewards work?"],
};

export const WellbieChatPanel = ({
  conversations,
  currentConversationId,
  messages,
  isLoading,
  error,
  onSendMessage,
  onSwitchConversation,
  onStartNew,
  onDeleteConversation,
  onClose,
  onMinimize,
}: WellbieChatPanelProps) => {
  const [input, setInput] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const location = useLocation();

  const ALLOWED_FILE_TYPES = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];
  const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

  const quickActions = quickActionsByPage[location.pathname] || [
    "How does Reclaim work?",
    "What are HSA tax benefits?",
  ];

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleSend = () => {
    if (input.trim() || attachments.length > 0) {
      const files = attachments.map((a) => a.file);
      onSendMessage(
        input || "I'm uploading a medical bill for analysis.",
        files.length > 0 ? files : undefined,
      );
      setInput("");
      setAttachments([]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);

    const validFiles = files.filter((file) => {
      if (!ALLOWED_FILE_TYPES.includes(file.type)) {
        logError(`File type ${file.type} not allowed`, null);
        return false;
      }
      if (file.size > MAX_FILE_SIZE) {
        logError(`File ${file.name} exceeds 10MB limit`, null);
        return false;
      }
      return true;
    });

    const newAttachments: FileAttachment[] = validFiles.map((file) => ({
      file,
      preview: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined,
      status: "pending",
    }));

    setAttachments((prev) => [...prev, ...newAttachments]);

    // Reset input so same file can be selected again
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => {
      const attachment = prev[index];
      if (attachment.preview) {
        URL.revokeObjectURL(attachment.preview);
      }
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleQuickAction = (action: string) => {
    onSendMessage(action);
  };

  const ConversationsList = () => (
    <div className="space-y-2">
      <Button
        onClick={onStartNew}
        variant="outline"
        className="w-full justify-start gap-2"
      >
        <MessageSquarePlus className="h-4 w-4" />
        New Conversation
      </Button>
      <ScrollArea className="h-[calc(100%-3rem)]">
        <div className="space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center justify-between p-2 rounded-md cursor-pointer hover:bg-accent",
                currentConversationId === conv.id && "bg-accent",
              )}
            >
              <button
                onClick={() => {
                  onSwitchConversation(conv.id);
                  setSidebarOpen(false);
                }}
                className="flex-1 text-left text-sm truncate"
              >
                {conv.title}
              </button>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteConversation(conv.id);
                }}
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-background border border-border rounded-lg shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-3 sm:p-4 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 h-8 w-8 sm:h-10 sm:w-10"
              >
                <Menu className="h-4 w-4" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[280px] sm:w-[350px]">
              <SheetHeader>
                <SheetTitle>Conversations</SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                <ConversationsList />
              </div>
            </SheetContent>
          </Sheet>
          <WellbieAvatar
            size="sm"
            animate={isLoading}
            state={isLoading ? "thinking" : "default"}
            className="shrink-0"
          />
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">
              Wellbie
            </h3>
            <p className="text-xs text-muted-foreground hidden sm:block">
              Your HSA strategy guide
            </p>
          </div>
        </div>
        <div className="flex gap-1 sm:gap-2 shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={onMinimize}
            className="h-8 w-8 sm:h-10 sm:w-10"
          >
            <Minimize2 className="h-3 w-3 sm:h-4 sm:w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-8 w-8 sm:h-10 sm:w-10"
          >
            <X className="h-3 w-3 sm:h-4 sm:w-4" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-3 sm:p-4">
        <div className="space-y-3 sm:space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-4 sm:py-8">
              <WellbieAvatar size="lg" className="mx-auto mb-3 sm:mb-4" />
              <p className="text-muted-foreground mb-3 sm:mb-4 text-xs sm:text-sm px-2">
                Hi! I'm Wellbie. Ask me anything about HSA strategies, expense
                tracking, or tax optimization!
              </p>
              <div className="flex flex-wrap gap-1 sm:gap-2 justify-center px-2">
                {quickActions.map((action) => (
                  <Button
                    key={action}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickAction(action)}
                    className="text-[10px] sm:text-xs h-7 sm:h-8"
                  >
                    {action}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {messages.map((message, i) => (
            <div
              key={i}
              className={cn(
                "flex gap-2 sm:gap-3",
                message.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              {message.role === "assistant" && (
                <WellbieAvatar size="sm" className="shrink-0 hidden sm:block" />
              )}
              <div
                className={cn(
                  "max-w-[85%] sm:max-w-[80%] rounded-lg px-3 py-2 whitespace-pre-wrap text-xs sm:text-sm",
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                )}
              >
                {message.content}
              </div>
            </div>
          ))}

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-2 sm:p-3 text-xs sm:text-sm text-destructive">
              {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </ScrollArea>

      {/* Input */}
      <div className="p-3 sm:p-4 border-t border-border bg-card shrink-0">
        {messages.length > 0 && (
          <div className="flex flex-wrap gap-1 sm:gap-2 mb-2 sm:mb-3">
            {quickActions.map((action) => (
              <Button
                key={action}
                variant="outline"
                size="sm"
                onClick={() => handleQuickAction(action)}
                className="text-[10px] sm:text-xs h-7 sm:h-8"
                disabled={isLoading}
              >
                {action}
              </Button>
            ))}
          </div>
        )}

        {/* File Attachments Preview */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2 sm:mb-3">
            {attachments.map((attachment, index) => (
              <div
                key={index}
                className="relative flex items-center gap-2 bg-muted rounded-lg p-2 pr-8"
              >
                {attachment.preview ? (
                  <img
                    src={attachment.preview}
                    alt={attachment.file.name}
                    className="h-8 w-8 object-cover rounded"
                  />
                ) : (
                  <FileText className="h-8 w-8 text-muted-foreground" />
                )}
                <div className="text-xs truncate max-w-[120px]">
                  {attachment.file.name}
                </div>
                {attachment.status === "uploading" ||
                attachment.status === "analyzing" ? (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                ) : (
                  <button
                    onClick={() => removeAttachment(index)}
                    className="absolute top-1 right-1 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.jpg,.jpeg,.png,.gif,.webp"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />

          {/* Attach file button */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="shrink-0 h-[50px] w-[50px] sm:h-[60px] sm:w-[60px]"
            title="Upload medical bill"
          >
            <Paperclip className="h-4 w-4" />
          </Button>

          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder={
              attachments.length > 0
                ? "Add a note about your bill..."
                : "Ask Wellbie anything..."
            }
            className="min-h-[50px] sm:min-h-[60px] resize-none text-xs sm:text-sm"
            disabled={isLoading}
          />
          <Button
            onClick={handleSend}
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
            size="icon"
            className="shrink-0 h-[50px] w-[50px] sm:h-[60px] sm:w-[60px]"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

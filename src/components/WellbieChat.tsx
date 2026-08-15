import { useState, useEffect } from "react";
import { WellbieAvatar } from "./WellbieAvatar";
import { WellbieChatPanel } from "./WellbieChatPanel";
import { useWellbieChat } from "@/hooks/useWellbieChat";

export const WellbieChat = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const {
    conversations,
    currentConversationId,
    messages,
    isLoading,
    error,
    sendMessage,
    switchConversation,
    startNewConversation,
    deleteConversation,
  } = useWellbieChat();

  const handleClose = () => {
    setIsOpen(false);
    setIsMinimized(false);
  };

  const handleMinimize = () => {
    setIsMinimized(true);
    setIsOpen(false);
  };

  const handleOpen = () => {
    setIsOpen(true);
    setIsMinimized(false);
  };

  // Listen for custom event to open Wellbie chat
  useEffect(() => {
    const handleOpenWellbie = () => {
      handleOpen();
    };

    window.addEventListener("openWellbieChat", handleOpenWellbie);
    return () =>
      window.removeEventListener("openWellbieChat", handleOpenWellbie);
  }, []);

  return (
    <>
      {/* Chat Panel with Backdrop */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-[50] animate-fade-in"
            onClick={handleClose}
            aria-hidden="true"
          />

          {/* Chat Panel - Fully responsive */}
          <div className="fixed inset-4 sm:bottom-6 sm:right-6 sm:top-auto sm:left-auto sm:w-[90vw] sm:max-w-[400px] sm:h-[85vh] sm:max-h-[600px] z-[55] animate-slide-in-right">
            <WellbieChatPanel
              conversations={conversations}
              currentConversationId={currentConversationId}
              messages={messages}
              isLoading={isLoading}
              error={error}
              onSendMessage={sendMessage}
              onSwitchConversation={switchConversation}
              onStartNew={startNewConversation}
              onDeleteConversation={deleteConversation}
              onClose={handleClose}
              onMinimize={handleMinimize}
            />
          </div>
        </>
      )}

      {/* Minimized State — hidden on mobile since bottom nav has the Wellbie tab */}
      {isMinimized && (
        <button
          onClick={handleOpen}
          className="hidden lg:flex fixed bottom-6 right-6 z-[55] bg-card border border-border rounded-lg shadow-lg hover:shadow-xl transition-all duration-200 p-3 items-center gap-2 hover:bg-accent"
          aria-label="Reopen Wellbie AI assistant chat"
        >
          <WellbieAvatar size="sm" />
          <span className="text-sm font-medium">Wellbie</span>
        </button>
      )}
    </>
  );
};

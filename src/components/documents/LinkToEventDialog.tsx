import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Loader2, Search, FolderHeart, Plus, Calendar } from "lucide-react";
import { format } from "date-fns";

interface LinkToEventDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentId: string;
  onSuccess: () => void;
}

// `medical_events` was renamed to `collections` in 20260131, which also
// dropped event_date, event_type and primary_provider. This component was
// still selecting and ordering by them, so the query failed at runtime.
interface MedicalEvent {
  id: string;
  title: string;
  created_at: string;
}

export function LinkToEventDialog({
  open,
  onOpenChange,
  documentId,
  onSuccess,
}: LinkToEventDialogProps) {
  const queryClient = useQueryClient();
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showNewEvent, setShowNewEvent] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");

  // Fetch existing medical events
  const { data: events, isLoading } = useQuery({
    queryKey: ["medical-events-for-linking"],
    queryFn: async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("collections")
        .select("id, title, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as MedicalEvent[];
    },
    enabled: open,
  });

  // Filter events by search
  const filteredEvents = events?.filter((event) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();
    // primary_provider and event_type were dropped along with medical_events;
    // title is the only searchable field collections still carries.
    return event.title.toLowerCase().includes(query);
  });

  // Link document to existing event
  const linkMutation = useMutation({
    mutationFn: async (eventId: string) => {
      const { error } = await supabase
        .from("receipts")
        .update({ collection_id: eventId })
        .eq("id", documentId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document linked to event");
      onSuccess();
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to link document");
    },
  });

  // Create new event and link
  const createAndLinkMutation = useMutation({
    mutationFn: async (title: string) => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Create new event
      const { data: newEvent, error: createError } = await supabase
        .from("collections")
        .insert({
          user_id: user.id,
          title,
          status: "active",
        })
        .select("id")
        .single();

      if (createError) throw createError;

      // Link document to new event
      const { error: linkError } = await supabase
        .from("receipts")
        .update({ collection_id: newEvent.id })
        .eq("id", documentId);

      if (linkError) throw linkError;

      return newEvent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["documents"] });
      queryClient.invalidateQueries({ queryKey: ["medical-events"] });
      toast.success("Event created and document linked");
      onSuccess();
      onOpenChange(false);
    },
    onError: () => {
      toast.error("Failed to create event");
    },
  });

  const handleLink = () => {
    if (showNewEvent && newEventTitle.trim()) {
      createAndLinkMutation.mutate(newEventTitle.trim());
    } else if (selectedEventId) {
      linkMutation.mutate(selectedEventId);
    }
  };

  const isLinking = linkMutation.isPending || createAndLinkMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Link to Medical Event</DialogTitle>
          <DialogDescription>
            Connect this document to a medical event for better organization.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Toggle between existing and new */}
          <div className="flex gap-2">
            <Button
              variant={!showNewEvent ? "default" : "outline"}
              size="sm"
              onClick={() => setShowNewEvent(false)}
              className="flex-1"
            >
              <FolderHeart className="h-4 w-4 mr-2" />
              Existing Event
            </Button>
            <Button
              variant={showNewEvent ? "default" : "outline"}
              size="sm"
              onClick={() => setShowNewEvent(true)}
              className="flex-1"
            >
              <Plus className="h-4 w-4 mr-2" />
              New Event
            </Button>
          </div>

          {showNewEvent ? (
            <div className="space-y-2">
              <Label htmlFor="new-event-title">Event Title</Label>
              <Input
                id="new-event-title"
                placeholder="e.g., Shoulder Surgery Jan 2026"
                value={newEventTitle}
                onChange={(e) => setNewEventTitle(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                You can add more details after creating the event.
              </p>
            </div>
          ) : (
            <>
              {/* Search */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search events..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9"
                />
              </div>

              {/* Event List */}
              {isLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : filteredEvents?.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FolderHeart className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No events found</p>
                  <Button
                    variant="link"
                    size="sm"
                    onClick={() => setShowNewEvent(true)}
                  >
                    Create a new event
                  </Button>
                </div>
              ) : (
                <ScrollArea className="h-[200px]">
                  <RadioGroup
                    value={selectedEventId}
                    onValueChange={setSelectedEventId}
                    className="space-y-2"
                  >
                    {filteredEvents?.map((event) => (
                      <div
                        key={event.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                          selectedEventId === event.id
                            ? "border-primary bg-primary/5"
                            : "hover:bg-muted/50"
                        }`}
                        onClick={() => setSelectedEventId(event.id)}
                      >
                        <RadioGroupItem value={event.id} id={event.id} />
                        <label
                          htmlFor={event.id}
                          className="flex-1 cursor-pointer"
                        >
                          <p className="font-medium">{event.title}</p>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                            <span className="flex items-center gap-1">
                              <Calendar className="h-3 w-3" />
                              {format(
                                new Date(event.created_at),
                                "MMM d, yyyy",
                              )}
                            </span>
                          </div>
                        </label>
                      </div>
                    ))}
                  </RadioGroup>
                </ScrollArea>
              )}
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleLink}
            disabled={
              isLinking ||
              (showNewEvent ? !newEventTitle.trim() : !selectedEventId)
            }
          >
            {isLinking && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {showNewEvent ? "Create & Link" : "Link to Event"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

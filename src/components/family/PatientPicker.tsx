// Workstream D1 — the roster picker.
//
// Replaces the free-text "Self / Spouse / Other..." input on every expense
// surface. The old control produced a string, which meant the app knew who an
// expense was for but never whether HSA money could pay for them — and a user
// who typed "Maya" three different ways had three different patients.
//
// Adding someone inline is deliberate. Forcing a trip to Settings mid-expense
// is how free-text inputs get reinvented.

import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, UserPlus } from "lucide-react";
import { toast } from "sonner";
import {
  useFamilyRoster,
  RELATIONSHIP_LABELS,
  type FamilyRelationship,
} from "@/hooks/useFamilyRoster";

const ADD_VALUE = "__add__";

export function PatientPicker({
  value,
  onChange,
  id = "patient",
}: {
  /** family_members.id, or null when nothing is chosen yet. */
  value: string | null;
  onChange: (patientId: string) => void;
  id?: string;
}) {
  const { members, addMember } = useFamilyRoster();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<FamilyRelationship>("child");

  const selected = members.find((m) => m.id === value) ?? null;
  const hasSpouse = members.some((m) => m.relationship === "spouse");

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      const created = await addMember.mutateAsync({
        name,
        relationship,
        taxDependent: relationship === "spouse" ? true : null,
      });
      onChange(created.id);
      setDialogOpen(false);
      setName("");
      setRelationship("child");
    } catch (err) {
      toast.error(
        err instanceof Error && /duplicate|unique/i.test(err.message)
          ? "Someone with that name is already on your list."
          : "Couldn't add them. Please try again.",
      );
    }
  };

  return (
    <>
      <Select
        value={value ?? undefined}
        onValueChange={(v) => {
          if (v === ADD_VALUE) {
            setDialogOpen(true);
            return;
          }
          onChange(v);
        }}
      >
        <SelectTrigger id={id}>
          <SelectValue placeholder="Who was this for?" />
        </SelectTrigger>
        <SelectContent>
          {members.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.name}
              {m.relationship !== "self" &&
                ` · ${RELATIONSHIP_LABELS[m.relationship]}`}
            </SelectItem>
          ))}
          {members.length > 0 && <SelectSeparator />}
          <SelectItem value={ADD_VALUE}>
            <span className="flex items-center gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              Add someone
            </span>
          </SelectItem>
        </SelectContent>
      </Select>

      {/* Warn at the point of entry, not at claim time. Telling someone their
          expense doesn't qualify only when they try to get their money back
          is the worst moment to find out. */}
      {selected?.qualifies_for_hsa === false && (
        <p className="flex items-start gap-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            {selected.name} isn&rsquo;t claimed as a tax dependent, so HSA money
            can&rsquo;t be used for their care. You can still record this
            expense &mdash; it just won&rsquo;t be claimable.
          </span>
        </p>
      )}
      {selected?.qualifies_for_hsa === null && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>
            We&rsquo;ll need to know whether you claim {selected.name} as a tax
            dependent before this can be reimbursed.
          </span>
        </p>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add someone to your family list</DialogTitle>
            <DialogDescription>
              HSA money can pay for you, your spouse, and anyone you claim as a
              tax dependent.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="picker-name">Name</Label>
              <Input
                id="picker-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Maya"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="picker-relationship">Relationship</Label>
              <Select
                value={relationship}
                onValueChange={(v) => setRelationship(v as FamilyRelationship)}
              >
                <SelectTrigger id="picker-relationship">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["spouse", "child", "other_dependent"] as const)
                    .filter((r) => r !== "spouse" || !hasSpouse)
                    .map((r) => (
                      <SelectItem key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {/* The dependency question is asked in Settings rather than here.
                Interrupting expense entry with a tax question is how people
                answer it carelessly, and this one decides whether their money
                comes back. */}
            {relationship !== "spouse" && (
              <p className="text-xs text-muted-foreground">
                We&rsquo;ll ask whether you claim them on your taxes in a moment
                &mdash; it decides whether their expenses qualify.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDialogOpen(false)}
              disabled={addMember.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAdd}
              disabled={addMember.isPending || !name.trim()}
            >
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

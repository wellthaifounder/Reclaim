// Workstream D1 — roster management.
//
// The screen where the tax-dependent question actually gets answered. It is
// worded carefully: "on your health plan" and "claimed on your taxes" are
// different questions, and users conflate them constantly. An adult child
// covered to 26 who files their own return is the case that costs money.

import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Users, Plus, Trash2, AlertTriangle, Check, X } from "lucide-react";
import { toast } from "sonner";
import {
  useFamilyRoster,
  memberEligibilitySummary,
  needsDependencyAnswer,
  RELATIONSHIP_LABELS,
  type FamilyMember,
  type FamilyRelationship,
} from "@/hooks/useFamilyRoster";

const ADDABLE: FamilyRelationship[] = ["spouse", "child", "other_dependent"];

function DependencyQuestion({
  member,
  onAnswer,
  disabled,
}: {
  member: FamilyMember;
  onAnswer: (value: boolean) => void;
  disabled: boolean;
}) {
  return (
    <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-sm font-medium text-foreground">
        Do you claim {member.name} as a dependent on your tax return?
      </p>
      {/* The whole point of the question. Users answer "yes" reflexively
          because the person is on their insurance, which is a different
          thing entirely. */}
      <p className="mt-1 text-xs text-muted-foreground">
        Being on your health plan isn&rsquo;t the same as being your tax
        dependent. A child can stay on your insurance until 26 and still file
        their own taxes &mdash; and if they do, HSA money can&rsquo;t be used
        for their care.
      </p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" disabled={disabled} onClick={() => onAnswer(true)}>
          <Check className="mr-1 h-3.5 w-3.5" />
          Yes, I claim them
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onAnswer(false)}
        >
          <X className="mr-1 h-3.5 w-3.5" />
          No, I don&rsquo;t
        </Button>
      </div>
    </div>
  );
}

function MemberRow({
  member,
  onAnswer,
  onRemove,
  busy,
}: {
  member: FamilyMember;
  onAnswer: (value: boolean) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const summary = memberEligibilitySummary(member);

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-foreground">{member.name}</p>
            <Badge variant="outline" className="text-[10px]">
              {RELATIONSHIP_LABELS[member.relationship]}
            </Badge>
          </div>
          <p
            className={`mt-0.5 text-xs ${
              summary.tone === "blocked"
                ? "text-destructive"
                : summary.tone === "warn"
                  ? "text-amber-600 dark:text-amber-500"
                  : "text-muted-foreground"
            }`}
          >
            {summary.text}
          </p>
        </div>

        {member.relationship !== "self" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-destructive"
            onClick={onRemove}
            disabled={busy}
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">Remove {member.name}</span>
          </Button>
        )}
      </div>

      {needsDependencyAnswer(member) && (
        <DependencyQuestion
          member={member}
          onAnswer={onAnswer}
          disabled={busy}
        />
      )}

      {/* Reversible, and says so. A "no" here makes their expenses
          unclaimable, which is a big enough consequence that the user needs
          to know it isn't final. */}
      {member.tax_dependent === false && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onAnswer(true)}
          className="mt-2 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-50"
        >
          Actually, I do claim {member.name}
        </button>
      )}
    </div>
  );
}

export function FamilyRosterCard() {
  const {
    members,
    unresolved,
    isLoading,
    addMember,
    updateMember,
    removeMember,
  } = useFamilyRoster();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [relationship, setRelationship] = useState<FamilyRelationship>("child");
  const [pendingRemoval, setPendingRemoval] = useState<FamilyMember | null>(
    null,
  );

  const busy =
    addMember.isPending || updateMember.isPending || removeMember.isPending;
  const hasSpouse = members.some((m) => m.relationship === "spouse");

  const handleAdd = async () => {
    if (!name.trim()) return;
    try {
      await addMember.mutateAsync({
        name,
        relationship,
        // A spouse qualifies regardless, so there is no question to leave
        // open. Everyone else starts unanswered on purpose.
        taxDependent: relationship === "spouse" ? true : null,
      });
      setName("");
      setRelationship("child");
      setAdding(false);
      toast.success("Added to your family list.");
    } catch (err) {
      const message =
        err instanceof Error && /duplicate|unique/i.test(err.message)
          ? "Someone with that name is already on the list."
          : "Couldn't add them. Please try again.";
      toast.error(message);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Who your HSA covers
        </CardTitle>
        <CardDescription>
          HSA money can pay for you, your spouse, and anyone you claim as a tax
          dependent. Tell us who&rsquo;s who and we&rsquo;ll flag expenses that
          don&rsquo;t qualify before you claim them.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {unresolved.length > 0 && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              We still need to know whether you claim{" "}
              {unresolved.map((m) => m.name).join(", ")} on your taxes. Until
              then we can&rsquo;t tell you if their expenses qualify.
            </AlertDescription>
          </Alert>
        )}

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading&hellip;</p>
        ) : (
          members.map((m) => (
            <MemberRow
              key={m.id}
              member={m}
              busy={busy}
              onAnswer={(value) =>
                updateMember.mutate({ id: m.id, taxDependent: value })
              }
              onRemove={() => setPendingRemoval(m)}
            />
          ))
        )}

        {adding ? (
          <div className="space-y-3 rounded-lg border border-dashed border-border p-3">
            <div className="space-y-1.5">
              <Label htmlFor="member-name">Name</Label>
              <Input
                id="member-name"
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Maya"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="member-relationship">Relationship</Label>
              <Select
                value={relationship}
                onValueChange={(v) => setRelationship(v as FamilyRelationship)}
              >
                <SelectTrigger id="member-relationship">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ADDABLE.filter((r) => r !== "spouse" || !hasSpouse).map(
                    (r) => (
                      <SelectItem key={r} value={r}>
                        {RELATIONSHIP_LABELS[r]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={busy || !name.trim()}
              >
                Add
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setAdding(false);
                  setName("");
                }}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            disabled={busy}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add someone
          </Button>
        )}
      </CardContent>

      <AlertDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => !open && setPendingRemoval(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {pendingRemoval?.name} from the list?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Their expenses stay exactly where they are &mdash; nothing is
              deleted. They&rsquo;ll just no longer be someone you can pick when
              recording a new one.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep them</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRemoval) removeMember.mutate(pendingRemoval.id);
                setPendingRemoval(null);
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

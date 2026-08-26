import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { useIsMobile } from "@/hooks/use-mobile";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useHSAAccounts } from "@/hooks/useHSAAccounts";
import {
  formatHSAAccountDateRange,
  validateHSAAccountDates,
} from "@/lib/hsaAccountUtils";
import type { HSAAccount } from "@/lib/hsaAccountUtils";
import { GenericSkeleton } from "@/components/skeletons/GenericSkeleton";
import { logError } from "@/utils/errorHandler";

export function HSAAccountManager() {
  const isMobile = useIsMobile();
  const { accounts, isLoading, createAccount, updateAccount, deleteAccount } =
    useHSAAccounts();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<HSAAccount | null>(null);
  const [deletingAccountId, setDeletingAccountId] = useState<string | null>(
    null,
  );

  const [formData, setFormData] = useState({
    account_name: "",
    opened_date: "",
    closed_date: "",
    is_active: true,
    eligibility_start_date: "",
    qle_type: "",
    notes: "",
  });
  const [formError, setFormError] = useState<string | null>(null);

  const resetForm = () => {
    setFormData({
      account_name: "",
      opened_date: "",
      closed_date: "",
      is_active: true,
      eligibility_start_date: "",
      qle_type: "",
      notes: "",
    });
    setFormError(null);
    setEditingAccount(null);
  };

  const handleOpenDialog = (account?: HSAAccount) => {
    if (account) {
      setEditingAccount(account);
      setFormData({
        account_name: account.account_name,
        opened_date: account.opened_date,
        closed_date: account.closed_date || "",
        is_active: account.is_active ?? true,
        eligibility_start_date: account.eligibility_start_date || "",
        qle_type: account.qle_type || "",
        notes: account.notes || "",
      });
    } else {
      resetForm();
    }
    setDialogOpen(true);
  };

  const handleCloseDialog = () => {
    setDialogOpen(false);
    setTimeout(resetForm, 200);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validate dates
    if (formData.closed_date) {
      const dateError = validateHSAAccountDates(
        formData.opened_date,
        formData.closed_date,
      );
      if (dateError) {
        setFormError(dateError);
        return;
      }
    }

    try {
      // eligibility_start_date, qle_type and notes are all present as of
      // 20260330_add_hsa_account_edge_case_fields.sql, so the previous
      // "retry without the extended columns" fallback was unreachable —
      // it only fired on a missing-column error that can no longer happen.
      const fields = {
        account_name: formData.account_name,
        opened_date: formData.opened_date,
        closed_date: formData.closed_date || null,
        is_active: formData.is_active,
        eligibility_start_date: formData.eligibility_start_date || null,
        qle_type: formData.qle_type || null,
        notes: formData.notes.trim() || null,
      };

      if (editingAccount) {
        await updateAccount({ id: editingAccount.id, updates: fields });
      } else {
        await createAccount(fields);
      }

      handleCloseDialog();
    } catch (error) {
      logError("Error saving HSA account", error);
      setFormError("Failed to save HSA account. Please try again.");
    }
  };

  const handleDeleteClick = (accountId: string) => {
    setDeletingAccountId(accountId);
    setDeleteDialogOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingAccountId) return;

    try {
      await deleteAccount(deletingAccountId);
      setDeleteDialogOpen(false);
      setDeletingAccountId(null);
    } catch (error) {
      logError("Error deleting HSA account", error);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        <GenericSkeleton />
        <GenericSkeleton />
      </div>
    );
  }

  const renderFormFields = () => (
    <div className="space-y-4 py-4">
      <div className="space-y-2">
        <Label htmlFor="account_name">Account Name</Label>
        <Input
          id="account_name"
          placeholder="e.g., Fidelity HSA 2024"
          value={formData.account_name}
          onChange={(e) =>
            setFormData({ ...formData, account_name: e.target.value })
          }
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="opened_date">Opened Date</Label>
        <Input
          id="opened_date"
          type="date"
          value={formData.opened_date}
          onChange={(e) =>
            setFormData({ ...formData, opened_date: e.target.value })
          }
          required
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="eligibility_start_date">
          Eligibility Start Date{" "}
          <span className="text-muted-foreground font-normal text-xs">
            (optional)
          </span>
        </Label>
        <Input
          id="eligibility_start_date"
          type="date"
          value={formData.eligibility_start_date}
          onChange={(e) =>
            setFormData({
              ...formData,
              eligibility_start_date: e.target.value,
            })
          }
        />
        <p className="text-xs text-muted-foreground">
          If your HSA eligibility began before you opened the account (e.g.
          retroactive election after a qualifying life event), enter that
          earlier date here.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="qle_type">
          What triggered this account?{" "}
          <span className="text-muted-foreground font-normal text-xs">
            (optional)
          </span>
        </Label>
        <Select
          value={formData.qle_type}
          onValueChange={(v) => setFormData({ ...formData, qle_type: v })}
        >
          <SelectTrigger id="qle_type">
            <SelectValue placeholder="Select a qualifying life event…" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="new_employment">
              New employment / employer plan
            </SelectItem>
            <SelectItem value="loss_of_coverage">
              Loss of prior coverage
            </SelectItem>
            <SelectItem value="marriage">Marriage</SelectItem>
            <SelectItem value="divorce">Divorce / separation</SelectItem>
            <SelectItem value="birth_adoption">Birth or adoption</SelectItem>
            <SelectItem value="plan_change">
              Mid-year plan change to HDHP
            </SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Helps accurately track which expenses are reimbursable when
          eligibility started mid-year.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="closed_date">
          Closed Date{" "}
          <span className="text-muted-foreground font-normal text-xs">
            (optional)
          </span>
        </Label>
        <Input
          id="closed_date"
          type="date"
          value={formData.closed_date}
          onChange={(e) =>
            setFormData({ ...formData, closed_date: e.target.value })
          }
        />
        <p className="text-xs text-muted-foreground">
          Leave empty if account is still active
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="notes">
          Notes{" "}
          <span className="text-muted-foreground font-normal text-xs">
            (optional)
          </span>
        </Label>
        <Textarea
          id="notes"
          placeholder="e.g. Switched to Fidelity HDHP Gold on July 1, covers spouse and dependents"
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          rows={2}
        />
      </div>
      <div className="flex items-center space-x-2">
        <Switch
          id="is_active"
          checked={formData.is_active}
          onCheckedChange={(checked) =>
            setFormData({ ...formData, is_active: checked })
          }
        />
        <Label htmlFor="is_active">Account is active</Label>
      </div>
      {formError && <p className="text-sm text-destructive">{formError}</p>}
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-foreground">
            HSA Accounts
          </h3>
          <p className="text-sm text-muted-foreground">
            Manage your Health Savings Accounts to track eligibility across
            different time periods
          </p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <Plus className="h-4 w-4 mr-2" />
          Add Account
        </Button>
      </div>

      {accounts.length === 0 ? (
        <Card className="p-8 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h4 className="text-lg font-medium text-foreground mb-2">
            No HSA Accounts
          </h4>
          <p className="text-sm text-muted-foreground mb-4">
            Add your HSA accounts to track which expenses are eligible for
            reimbursement
          </p>
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Your First Account
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {accounts.map((account) => (
            <Card key={account.id} className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h4 className="font-medium text-foreground">
                      {account.account_name}
                    </h4>
                    {account.is_active && !account.closed_date && (
                      <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                        Active
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatHSAAccountDateRange(account)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleOpenDialog(account)}
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteClick(account.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {isMobile ? (
        <Drawer open={dialogOpen} onOpenChange={setDialogOpen}>
          <DrawerContent className="max-h-[85vh]">
            <DrawerHeader>
              <DrawerTitle>
                {editingAccount ? "Edit HSA Account" : "Add HSA Account"}
              </DrawerTitle>
              <DrawerDescription>
                {editingAccount
                  ? "Update your HSA account details"
                  : "Add a new HSA account to track eligibility"}
              </DrawerDescription>
            </DrawerHeader>
            <form onSubmit={handleSubmit} className="overflow-y-auto px-4">
              {renderFormFields()}
              <DrawerFooter className="px-0">
                <Button type="submit">
                  {editingAccount ? "Update Account" : "Add Account"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCloseDialog}
                >
                  Cancel
                </Button>
              </DrawerFooter>
            </form>
          </DrawerContent>
        </Drawer>
      ) : (
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingAccount ? "Edit HSA Account" : "Add HSA Account"}
              </DialogTitle>
              <DialogDescription>
                {editingAccount
                  ? "Update your HSA account details"
                  : "Add a new HSA account to track eligibility"}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit}>
              {renderFormFields()}
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleCloseDialog}
                >
                  Cancel
                </Button>
                <Button type="submit">
                  {editingAccount ? "Update Account" : "Add Account"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      )}

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete HSA Account</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this HSA account? This action
              cannot be undone. Historical reimbursement requests will still
              show which account was used.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDeletingAccountId(null)}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

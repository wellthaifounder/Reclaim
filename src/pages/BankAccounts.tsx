import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { PlaidLink } from "@/components/PlaidLink";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Building2,
  RefreshCw,
  Trash2,
  ArrowLeft,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { Database } from "@/integrations/supabase/types";
import { logError } from "@/utils/errorHandler";
import { Alert, AlertDescription } from "@/components/ui/alert";

type PlaidConnection = Database["public"]["Tables"]["plaid_connections"]["Row"];

export default function BankAccounts() {
  const navigate = useNavigate();
  const [connections, setConnections] = useState<PlaidConnection[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncErrors, setSyncErrors] = useState<
    Record<string, { count: number }>
  >({});

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) return;
    fetchConnections();
  };

  const fetchConnections = async () => {
    try {
      const { data, error } = await supabase
        .from("plaid_connections")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setConnections(data || []);
    } catch (error) {
      logError("Error fetching connections", error);
      toast.error("Failed to load bank connections");
    } finally {
      setLoading(false);
    }
  };

  const handleSync = async (connectionId: string) => {
    const MAX_ATTEMPTS = 3;
    const RETRY_DELAYS = [0, 2000, 4000];

    setSyncing(connectionId);
    setSyncErrors((prev) => {
      const next = { ...prev };
      delete next[connectionId];
      return next;
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (attempt > 1) {
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAYS[attempt - 1]),
        );
        setSyncErrors((prev) => ({
          ...prev,
          [connectionId]: { count: attempt - 1 },
        }));
      }

      try {
        const { data, error } = await supabase.functions.invoke(
          "plaid-sync-transactions",
          {
            body: { connection_id: connectionId },
          },
        );

        if (error) throw error;

        setSyncErrors((prev) => {
          const next = { ...prev };
          delete next[connectionId];
          return next;
        });
        toast.success(
          `Synced ${data.inserted} new transactions (${data.medical_detected} medical)`,
        );
        fetchConnections();
        setSyncing(null);
        return;
      } catch (error) {
        logError("Error syncing transactions (attempt " + attempt + ")", error);
        if (attempt === MAX_ATTEMPTS) {
          setSyncErrors((prev) => ({
            ...prev,
            [connectionId]: { count: MAX_ATTEMPTS },
          }));
          toast.error(
            "Sync failed after 3 attempts. Try again later or re-link the account.",
          );
          setSyncing(null);
        }
      }
    }
  };

  const handleDelete = async (connectionId: string) => {
    if (!confirm("Are you sure you want to disconnect this bank account?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from("plaid_connections")
        .delete()
        .eq("id", connectionId);

      if (error) throw error;

      toast.success("Bank account disconnected");
      fetchConnections();
    } catch (error) {
      logError("Error deleting connection", error);
      toast.error("Failed to disconnect bank account");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-4xl">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-foreground">
                Bank Accounts
              </h1>
              <p className="text-muted-foreground mt-1">
                Connect your bank accounts to automatically import transactions
              </p>
            </div>
            <PlaidLink onSuccess={fetchConnections} />
          </div>
        </div>

        {connections.length === 0 ? (
          <Card>
            <CardContent className="pt-12 pb-12 text-center">
              <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">
                No bank accounts connected
              </h3>
              <p className="text-muted-foreground mb-6">
                Connect your bank account to automatically track and categorize
                transactions
              </p>
              <PlaidLink onSuccess={fetchConnections} />
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            {connections.map((connection) => (
              <Card key={connection.id}>
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <Building2 className="h-8 w-8 text-primary" />
                      <div>
                        <CardTitle>{connection.institution_name}</CardTitle>
                        <CardDescription>
                          Connected{" "}
                          {format(
                            new Date(connection.created_at),
                            "MMM d, yyyy",
                          )}
                          {connection.last_synced_at && (
                            <>
                              {" "}
                              • Last synced{" "}
                              {format(
                                new Date(connection.last_synced_at),
                                "MMM d, yyyy",
                              )}
                            </>
                          )}
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSync(connection.id)}
                        disabled={syncing === connection.id}
                      >
                        <RefreshCw
                          className={`h-4 w-4 mr-2 ${syncing === connection.id ? "animate-spin" : ""}`}
                        />
                        {syncing === connection.id ? "Syncing..." : "Sync"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => handleDelete(connection.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {syncErrors[connection.id] && (
                    <Alert variant="destructive" className="mt-3">
                      <AlertCircle className="h-4 w-4" />
                      <AlertDescription>
                        {syncErrors[connection.id].count >= 3
                          ? "Sync failed 3 times. Your connection may need to be re-linked. Try disconnecting and reconnecting."
                          : `Sync failed (attempt ${syncErrors[connection.id].count}/3). Retrying...`}
                      </AlertDescription>
                    </Alert>
                  )}
                </CardHeader>
              </Card>
            ))}
          </div>
        )}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>About Transaction Import</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>
              • Transactions are automatically categorized as medical or
              non-medical
            </p>
            <p>
              • Medical transactions are flagged as HSA-eligible for easy
              reimbursement
            </p>
            <p>
              • You can manually review and adjust categorization in the
              Transactions page
            </p>
            <p>• Transactions sync up to 2 years of history</p>
          </CardContent>
        </Card>
      </div>
    </AuthenticatedLayout>
  );
}

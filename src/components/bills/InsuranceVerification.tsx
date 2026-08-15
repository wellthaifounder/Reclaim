import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Shield,
  Phone,
  Mail,
} from "lucide-react";
import { toast } from "sonner";
import { logError } from "@/utils/errorHandler";

interface InsuranceVerificationProps {
  insuranceCompany?: string;
  claimNumber?: string;
  onVerificationComplete?: (data: any) => void;
}

export function InsuranceVerification({
  insuranceCompany,
  claimNumber,
  onVerificationComplete,
}: InsuranceVerificationProps) {
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationData, setVerificationData] = useState<any>(null);
  const [formData, setFormData] = useState({
    insuranceCompany: insuranceCompany || "",
    claimNumber: claimNumber || "",
    policyNumber: "",
    dateOfService: "",
  });

  const handleVerify = async () => {
    if (!formData.insuranceCompany || !formData.policyNumber) {
      toast.error("Please provide insurance company and policy number");
      return;
    }

    setIsVerifying(true);

    try {
      // Simulate verification (in production, this would call an insurance verification API)
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const mockVerification = {
        verified: true,
        coverageActive: true,
        deductibleMet: Math.random() > 0.5,
        deductibleRemaining: Math.floor(Math.random() * 2000),
        copayAmount: Math.floor(Math.random() * 50) + 10,
        coinsuranceRate: 20,
        outOfPocketMax: 6000,
        outOfPocketRemaining: Math.floor(Math.random() * 3000),
        priorAuthRequired: Math.random() > 0.7,
        networkStatus: Math.random() > 0.3 ? "in-network" : "out-of-network",
        verifiedAt: new Date().toISOString(),
      };

      setVerificationData(mockVerification);
      onVerificationComplete?.(mockVerification);
      toast.success("Insurance verified successfully");
    } catch (error) {
      logError("Verification error", error);
      toast.error("Failed to verify insurance");
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Insurance Verification
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Verify coverage and benefit details for this claim
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Verification Form */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="insuranceCompany">Insurance Company *</Label>
            <Input
              id="insuranceCompany"
              value={formData.insuranceCompany}
              onChange={(e) =>
                setFormData({ ...formData, insuranceCompany: e.target.value })
              }
              placeholder="e.g., Blue Cross Blue Shield"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="policyNumber">Policy Number *</Label>
            <Input
              id="policyNumber"
              value={formData.policyNumber}
              onChange={(e) =>
                setFormData({ ...formData, policyNumber: e.target.value })
              }
              placeholder="e.g., ABC123456789"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="claimNumber">Claim Number</Label>
            <Input
              id="claimNumber"
              value={formData.claimNumber}
              onChange={(e) =>
                setFormData({ ...formData, claimNumber: e.target.value })
              }
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="dateOfService">Date of Service</Label>
            <Input
              id="dateOfService"
              type="date"
              value={formData.dateOfService}
              onChange={(e) =>
                setFormData({ ...formData, dateOfService: e.target.value })
              }
            />
          </div>
        </div>

        <Button
          onClick={handleVerify}
          disabled={
            isVerifying || !formData.insuranceCompany || !formData.policyNumber
          }
          className="w-full"
        >
          {isVerifying ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying Coverage...
            </>
          ) : (
            <>
              <Shield className="mr-2 h-4 w-4" />
              Verify Insurance
            </>
          )}
        </Button>

        {/* Verification Results */}
        {verificationData && (
          <div className="space-y-4 pt-4 border-t">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              <h4 className="font-semibold">Verification Successful</h4>
              <Badge variant="outline" className="ml-auto">
                {new Date(verificationData.verifiedAt).toLocaleDateString()}
              </Badge>
            </div>

            {/* Coverage Status */}
            <div className="grid gap-4 md:grid-cols-2">
              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Coverage Status
                </p>
                <Badge
                  variant={
                    verificationData.coverageActive ? "default" : "destructive"
                  }
                >
                  {verificationData.coverageActive ? "Active" : "Inactive"}
                </Badge>
              </div>

              <div className="p-4 bg-muted/50 rounded-lg">
                <p className="text-sm text-muted-foreground mb-1">
                  Network Status
                </p>
                <Badge
                  variant={
                    verificationData.networkStatus === "in-network"
                      ? "default"
                      : "secondary"
                  }
                >
                  {verificationData.networkStatus}
                </Badge>
              </div>
            </div>

            {/* Financial Details */}
            <div className="space-y-3">
              <h4 className="font-semibold">Financial Details</h4>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="flex justify-between p-3 bg-muted/30 rounded">
                  <span className="text-sm">Deductible Remaining</span>
                  <span className="font-semibold">
                    ${verificationData.deductibleRemaining}
                  </span>
                </div>

                <div className="flex justify-between p-3 bg-muted/30 rounded">
                  <span className="text-sm">Copay Amount</span>
                  <span className="font-semibold">
                    ${verificationData.copayAmount}
                  </span>
                </div>

                <div className="flex justify-between p-3 bg-muted/30 rounded">
                  <span className="text-sm">Coinsurance Rate</span>
                  <span className="font-semibold">
                    {verificationData.coinsuranceRate}%
                  </span>
                </div>

                <div className="flex justify-between p-3 bg-muted/30 rounded">
                  <span className="text-sm">Out-of-Pocket Remaining</span>
                  <span className="font-semibold">
                    ${verificationData.outOfPocketRemaining}
                  </span>
                </div>
              </div>
            </div>

            {/* Alerts */}
            {verificationData.priorAuthRequired && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Prior Authorization Required:</strong> This procedure
                  may require prior authorization from your insurance company.
                </AlertDescription>
              </Alert>
            )}

            {verificationData.networkStatus === "out-of-network" && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Out-of-Network Provider:</strong> This provider is
                  out-of-network. You may have higher out-of-pocket costs.
                </AlertDescription>
              </Alert>
            )}

            {/* Contact Information */}
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <p className="font-semibold text-sm">
                Need to Contact Your Insurance?
              </p>
              <div className="flex flex-col gap-2 text-sm">
                <div className="flex items-center gap-2">
                  <Phone className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Member Services:
                  </span>
                  <span className="font-medium">1-800-INSURANCE</span>
                </div>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">
                    Claims Department:
                  </span>
                  <span className="font-medium">claims@insurance.com</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Information Note */}
        <div className="p-4 bg-muted/30 rounded-lg text-sm space-y-2">
          <p className="font-semibold">About Insurance Verification</p>
          <ul className="space-y-1 text-muted-foreground list-disc list-inside">
            <li>Verification confirms your current coverage and benefits</li>
            <li>
              Benefits shown are estimates and subject to actual claim
              processing
            </li>
            <li>
              Always call your insurance for the most accurate information
            </li>
            <li>Keep your verification reference number for disputes</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

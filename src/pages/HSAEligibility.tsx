import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AuthenticatedLayout } from "@/components/AuthenticatedLayout";
import { FF } from "@/lib/featureFlags";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Search,
  BookOpen,
  ExternalLink,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  FileText,
  Grid3x3,
  List,
  MessageCircle,
  Sparkles,
  ArrowLeft,
} from "lucide-react";
import {
  hsaEligibilityItems,
  searchEligibilityItems,
  CATEGORIES,
  getCategoryCounts,
  type HSAEligibilityItem,
  type EligibilityStatus,
} from "@/lib/hsaEligibilityData";

export default function HSAEligibility() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] =
    useState<EligibilityStatus | null>(null);
  const [selectedItem, setSelectedItem] = useState<HSAEligibilityItem | null>(
    null,
  );
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const categoryCounts = getCategoryCounts();

  // Apply filters
  let filteredItems = searchQuery
    ? searchEligibilityItems(searchQuery)
    : hsaEligibilityItems;

  if (selectedCategories.length > 0) {
    filteredItems = filteredItems.filter((item) =>
      selectedCategories.includes(item.category),
    );
  }

  if (selectedStatus) {
    filteredItems = filteredItems.filter(
      (item) => item.status === selectedStatus,
    );
  }

  const toggleCategory = (category: string) => {
    setSelectedCategories((prev) =>
      prev.includes(category)
        ? prev.filter((c) => c !== category)
        : [...prev, category],
    );
  };

  const getStatusColor = (status: EligibilityStatus) => {
    switch (status) {
      case "eligible":
        return "bg-success text-success-foreground";
      case "not-eligible":
        return "bg-destructive text-destructive-foreground";
      case "conditional":
        return "bg-accent text-accent-foreground";
    }
  };

  const getStatusIcon = (status: EligibilityStatus) => {
    switch (status) {
      case "eligible":
        return <CheckCircle2 className="h-4 w-4" />;
      case "not-eligible":
        return <XCircle className="h-4 w-4" />;
      case "conditional":
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getStatusLabel = (status: EligibilityStatus) => {
    switch (status) {
      case "eligible":
        return "HSA Eligible";
      case "not-eligible":
        return "Not Eligible";
      case "conditional":
        return "Conditionally Eligible";
    }
  };

  return (
    <AuthenticatedLayout>
      <div className="container mx-auto px-4 py-8 pb-24 md:pb-8 max-w-7xl">
        <div className="mb-6">
          <Button variant="ghost" onClick={() => navigate("/dashboard")}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-3">HSA Eligibility Reference</h1>
          <p className="text-muted-foreground text-lg">
            Quickly check if medical expenses qualify for HSA reimbursement
            based on IRS guidelines
          </p>
        </div>

        {/* Disclaimer */}
        <Alert className="mb-6 border-accent">
          <BookOpen className="h-4 w-4" />
          <AlertDescription>
            This tool provides general information based on IRS Publication 502.
            HSA administrators may have different rules. Always consult a tax
            professional for your specific situation and keep all receipts.
          </AlertDescription>
        </Alert>

        {/* Wellbie AI Helper Card — hidden for soft launch (v1.1) via FF. */}
        {FF.WELLBIE_ENABLED && (
          <Card className="mb-6 border-primary/50 bg-gradient-to-r from-primary/5 to-primary/10">
            <CardContent className="pt-6">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="h-12 w-12 rounded-full bg-primary/20 flex items-center justify-center">
                    <Sparkles className="h-6 w-6 text-primary" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-lg mb-2 flex items-center gap-2">
                    <MessageCircle className="h-5 w-5" />
                    Ask Wellbie for Personalized Help
                  </h3>
                  <p className="text-muted-foreground mb-3">
                    Not sure if a specific purchase qualifies? Ask Wellbie, your
                    AI assistant, for instant guidance on HSA eligibility. Just
                    describe your expense and get personalized answers based on
                    IRS guidelines.
                  </p>
                  <p className="text-sm text-muted-foreground italic">
                    Try asking: "Is a massage HSA eligible?" or "Can I use my
                    HSA for prescription sunglasses?"
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Search and Filters */}
        <Card className="mb-6">
          <CardContent className="pt-6">
            <div className="flex flex-col gap-4">
              {/* Search Bar */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search expenses (e.g., 'glasses', 'therapy', 'vitamins')..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Status Filters */}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant={selectedStatus === null ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSelectedStatus(null)}
                >
                  All Items
                </Button>
                <Button
                  variant={
                    selectedStatus === "eligible" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setSelectedStatus("eligible")}
                >
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Eligible
                </Button>
                <Button
                  variant={
                    selectedStatus === "conditional" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setSelectedStatus("conditional")}
                >
                  <AlertTriangle className="h-4 w-4 mr-1" />
                  Conditional
                </Button>
                <Button
                  variant={
                    selectedStatus === "not-eligible" ? "default" : "outline"
                  }
                  size="sm"
                  onClick={() => setSelectedStatus("not-eligible")}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Not Eligible
                </Button>

                <div className="ml-auto flex gap-2">
                  <Button
                    variant={viewMode === "grid" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("grid")}
                  >
                    <Grid3x3 className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setViewMode("list")}
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Category Filter */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Filter by Category</CardTitle>
            <CardDescription>
              Select multiple categories to filter results
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={
                  selectedCategories.length === 0 ? "default" : "outline"
                }
                size="sm"
                onClick={() => setSelectedCategories([])}
              >
                All Categories
              </Button>
              {Object.values(CATEGORIES).map((category) => (
                <Button
                  key={category}
                  variant={
                    selectedCategories.includes(category)
                      ? "default"
                      : "outline"
                  }
                  size="sm"
                  onClick={() => toggleCategory(category)}
                >
                  {category} ({categoryCounts[category] || 0})
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Active Filters */}
        {(selectedCategories.length > 0 || selectedStatus) && (
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <span className="text-sm text-muted-foreground">
              Active filters:
            </span>
            {selectedCategories.map((category) => (
              <Badge key={category} variant="outline" className="gap-1">
                {category}
                <button
                  onClick={() => toggleCategory(category)}
                  className="ml-1 hover:text-destructive"
                >
                  ×
                </button>
              </Badge>
            ))}
            {selectedStatus && (
              <Badge variant="outline" className="gap-1">
                {getStatusLabel(selectedStatus)}
                <button
                  onClick={() => setSelectedStatus(null)}
                  className="ml-1 hover:text-destructive"
                >
                  ×
                </button>
              </Badge>
            )}
          </div>
        )}

        {/* Results */}
        {filteredItems.length === 0 ? (
          <Card>
            <CardContent className="pt-6 text-center text-muted-foreground">
              No items found matching your search criteria.
            </CardContent>
          </Card>
        ) : (
          <div className="mb-6">
            <p className="text-sm text-muted-foreground mb-4">
              Showing {filteredItems.length}{" "}
              {filteredItems.length === 1 ? "item" : "items"}
            </p>
            <div
              className={
                viewMode === "grid"
                  ? "grid gap-4 md:grid-cols-2 lg:grid-cols-3"
                  : "space-y-3"
              }
            >
              {filteredItems.map((item) => (
                <Card
                  key={item.id}
                  className="cursor-pointer hover:border-primary transition-colors"
                  onClick={() => setSelectedItem(item)}
                >
                  <CardHeader>
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg">{item.name}</CardTitle>
                      <Badge className={getStatusColor(item.status)}>
                        {getStatusIcon(item.status)}
                      </Badge>
                    </div>
                    <CardDescription className="line-clamp-2">
                      {item.description}
                    </CardDescription>
                  </CardHeader>
                  {viewMode === "list" && (
                    <CardContent>
                      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">{item.category}</Badge>
                        {item.requiresLMN && (
                          <Badge variant="outline" className="gap-1">
                            <FileText className="h-3 w-3" />
                            LMN Required
                          </Badge>
                        )}
                      </div>
                    </CardContent>
                  )}
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <BookOpen className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
              <div className="space-y-2">
                <h3 className="font-semibold">Need More Information?</h3>
                <p className="text-sm text-muted-foreground">
                  This reference tool covers the most common medical expenses.
                  For complete details and edge cases, refer to the full IRS
                  Publication 502 or consult with a tax professional.
                </p>
                <div className="flex gap-3">
                  <a
                    href="https://www.irs.gov/pub/irs-pdf/p502.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                  >
                    IRS Publication 502 (PDF)
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Item Detail Dialog */}
        {selectedItem && (
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedItem(null)}
          >
            <Card
              className="max-w-2xl w-full max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1">
                    <CardTitle className="text-2xl mb-2">
                      {selectedItem.name}
                    </CardTitle>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <Badge className={getStatusColor(selectedItem.status)}>
                        {getStatusIcon(selectedItem.status)}
                        <span className="ml-1">
                          {getStatusLabel(selectedItem.status)}
                        </span>
                      </Badge>
                      <Badge variant="outline">{selectedItem.category}</Badge>
                      {selectedItem.requiresLMN && (
                        <Badge variant="outline" className="gap-1">
                          <FileText className="h-3 w-3" />
                          Letter of Medical Necessity Required
                        </Badge>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedItem(null)}
                  >
                    ×
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="font-semibold mb-2">Description</h3>
                  <p className="text-muted-foreground">
                    {selectedItem.description}
                  </p>
                </div>

                {selectedItem.conditions && (
                  <div>
                    <h3 className="font-semibold mb-2">Conditions</h3>
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        {selectedItem.conditions}
                      </AlertDescription>
                    </Alert>
                  </div>
                )}

                <div>
                  <h3 className="font-semibold mb-2">IRS Reference</h3>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <BookOpen className="h-4 w-4" />
                    <span>{selectedItem.irsReference}</span>
                    <a
                      href="https://www.irs.gov/pub/irs-pdf/p502.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline inline-flex items-center gap-1"
                    >
                      View Full Publication
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                </div>

                {selectedItem.keywords && selectedItem.keywords.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-2">Related Terms</h3>
                    <div className="flex flex-wrap gap-2">
                      {selectedItem.keywords.map((keyword, index) => (
                        <Badge key={index} variant="secondary">
                          {keyword}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t">
                  <Button
                    variant="outline"
                    className="w-full"
                    onClick={() => setSelectedItem(null)}
                  >
                    Close
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </AuthenticatedLayout>
  );
}

import jsPDF from "jspdf";
import { format } from "date-fns";

interface Invoice {
  id: string;
  date: string;
  amount: number;
  vendor: string;
  category: string;
  is_hsa_eligible: boolean;
  is_reimbursed: boolean;
}

interface Receipt {
  id: string;
  invoice_id: string;
  file_path: string;
  document_type: string;
}

interface TaxYearData {
  invoices: Invoice[];
  receipts: Receipt[];
  taxYear: number;
}

export const generateTaxPackageReport = async (
  data: TaxYearData,
): Promise<Blob> => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 20;
  const contentWidth = pageWidth - 2 * margin;

  // Brand colors
  const primaryColor: [number, number, number] = [26, 188, 156];
  const accentColor: [number, number, number] = [52, 152, 219];
  const textColor: [number, number, number] = [44, 62, 80];

  let yPosition = margin;

  // Helper function to add page header
  const addPageHeader = (title: string) => {
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 30, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.setFont("helvetica", "bold");
    doc.text(title, margin, 20);
  };

  // Helper function to check and add new page
  const checkPageBreak = (requiredSpace: number) => {
    if (yPosition + requiredSpace > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
      return true;
    }
    return false;
  };

  // Filter HSA-eligible invoices
  const hsaInvoices = data.invoices.filter((inv) => inv.is_hsa_eligible);
  const unreimbursedInvoices = hsaInvoices.filter((inv) => !inv.is_reimbursed);
  const reimbursedInvoices = hsaInvoices.filter((inv) => inv.is_reimbursed);

  // Calculate totals
  const totalQualifiedExpenses = hsaInvoices.reduce(
    (sum, inv) => sum + inv.amount,
    0,
  );
  const totalReimbursed = reimbursedInvoices.reduce(
    (sum, inv) => sum + inv.amount,
    0,
  );
  const totalUnreimbursed = unreimbursedInvoices.reduce(
    (sum, inv) => sum + inv.amount,
    0,
  );

  // Group by category
  const byCategory = hsaInvoices.reduce(
    (acc, inv) => {
      acc[inv.category] = (acc[inv.category] || 0) + inv.amount;
      return acc;
    },
    {} as Record<string, number>,
  );

  // PAGE 1: Cover Page
  addPageHeader(`${data.taxYear} HSA Tax Package`);
  yPosition = 50;

  doc.setTextColor(...textColor);
  doc.setFontSize(14);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Generated: ${format(new Date(), "MMMM d, yyyy")}`,
    margin,
    yPosition,
  );
  yPosition += 20;

  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("IRS-Ready HSA Documentation Package", margin, yPosition);
  yPosition += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const introText = [
    "This package contains comprehensive documentation of your HSA-eligible medical expenses",
    "for tax year " + data.taxYear + ". Use this report to:",
    "",
    "• Complete IRS Form 8889 (Health Savings Accounts)",
    "• Substantiate HSA withdrawals if audited",
    "• Provide documentation to your tax preparer",
    "• Maintain required records per IRS regulations",
  ];
  introText.forEach((line) => {
    doc.text(line, margin, yPosition);
    yPosition += 6;
  });

  yPosition += 10;
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, yPosition, contentWidth, 50, "F");
  yPosition += 10;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("Quick Summary:", margin + 5, yPosition);
  yPosition += 8;

  doc.setFont("helvetica", "normal");
  doc.text(
    `Total Qualified Medical Expenses: $${totalQualifiedExpenses.toFixed(2)}`,
    margin + 5,
    yPosition,
  );
  yPosition += 6;
  doc.text(
    `Total Reimbursed: $${totalReimbursed.toFixed(2)}`,
    margin + 5,
    yPosition,
  );
  yPosition += 6;
  doc.text(
    `Available to Reimburse: $${totalUnreimbursed.toFixed(2)}`,
    margin + 5,
    yPosition,
  );
  yPosition += 6;
  doc.text(
    `Number of Qualified Expenses: ${hsaInvoices.length}`,
    margin + 5,
    yPosition,
  );

  // PAGE 2: Form 8889 Helper Worksheet
  doc.addPage();
  addPageHeader("Form 8889 Helper Worksheet");
  yPosition = 50;

  doc.setTextColor(...textColor);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("IRS Form 8889 Line Item Reference", margin, yPosition);
  yPosition += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "italic");
  const disclaimerText = doc.splitTextToSize(
    "Note: This worksheet helps you complete Form 8889. Please consult IRS Form 8889 instructions " +
      "and your tax advisor for complete guidance. You will need additional information such as HSA " +
      "contributions, HDHP coverage months, and employer contributions to complete the full form.",
    contentWidth,
  );
  disclaimerText.forEach((line: string) => {
    doc.text(line, margin, yPosition);
    yPosition += 5;
  });
  yPosition += 10;

  // Form 8889 Part II - HSA Distributions
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Part II: HSA Distributions", margin, yPosition);
  yPosition += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const formLines = [
    {
      line: "14a",
      description: "Total distributions from all HSAs",
      value: "See your HSA provider's Form 1099-SA",
    },
    {
      line: "14b",
      description: "HSA distributions used for qualified medical expenses",
      value: `$${totalReimbursed.toFixed(2)}`,
    },
    {
      line: "15",
      description: "Taxable HSA distributions",
      value: "Line 14a minus Line 14b (if positive)",
    },
  ];

  formLines.forEach((item) => {
    doc.setFont("helvetica", "bold");
    doc.text(`Line ${item.line}: `, margin, yPosition);
    doc.setFont("helvetica", "normal");
    doc.text(`${item.description}`, margin + 20, yPosition);
    yPosition += 6;
    doc.setFont("helvetica", "italic");
    doc.text(`Value: ${item.value}`, margin + 25, yPosition);
    yPosition += 10;
  });

  yPosition += 5;
  doc.setFillColor(255, 243, 205);
  doc.rect(margin, yPosition, contentWidth, 30, "F");
  yPosition += 8;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("⚠️ Important:", margin + 5, yPosition);
  yPosition += 6;
  doc.setFont("helvetica", "normal");
  const warningText = doc.splitTextToSize(
    "The amount shown for Line 14b represents HSA-eligible expenses that were marked as reimbursed " +
      "in our system. Ensure this matches your actual HSA withdrawals for the tax year.",
    contentWidth - 10,
  );
  warningText.forEach((line: string) => {
    doc.text(line, margin + 5, yPosition);
    yPosition += 5;
  });

  // PAGE 3: Itemized Expense List
  doc.addPage();
  addPageHeader("Itemized Qualified Medical Expenses");
  yPosition = 50;

  doc.setTextColor(...textColor);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Tax Year ${data.taxYear} - HSA-Eligible Expenses`,
    margin,
    yPosition,
  );
  yPosition += 10;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Total Qualified Expenses: $${totalQualifiedExpenses.toFixed(2)}`,
    margin,
    yPosition,
  );
  yPosition += 15;

  // Table header
  doc.setFillColor(...accentColor);
  doc.rect(margin, yPosition - 5, contentWidth, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Date", margin + 2, yPosition);
  doc.text("Vendor", margin + 25, yPosition);
  doc.text("Category", margin + 80, yPosition);
  doc.text("Amount", margin + 125, yPosition);
  doc.text("Status", margin + 155, yPosition);
  yPosition += 10;

  // Table rows
  doc.setTextColor(...textColor);
  doc.setFont("helvetica", "normal");
  let rowIndex = 0;

  hsaInvoices.forEach((invoice) => {
    checkPageBreak(8);

    // Alternate row colors
    if (rowIndex % 2 === 0) {
      doc.setFillColor(248, 248, 248);
      doc.rect(margin, yPosition - 5, contentWidth, 7, "F");
    }

    doc.setFontSize(8);
    doc.text(
      format(new Date(invoice.date), "MM/dd/yyyy"),
      margin + 2,
      yPosition,
    );

    const vendorText =
      invoice.vendor.length > 20
        ? invoice.vendor.substring(0, 20) + "..."
        : invoice.vendor;
    doc.text(vendorText, margin + 25, yPosition);

    const categoryText =
      invoice.category.length > 18
        ? invoice.category.substring(0, 18) + "..."
        : invoice.category;
    doc.text(categoryText, margin + 80, yPosition);

    doc.text(`$${invoice.amount.toFixed(2)}`, margin + 125, yPosition);
    doc.text(
      invoice.is_reimbursed ? "Reimbursed" : "Unreimbursed",
      margin + 155,
      yPosition,
    );

    yPosition += 7;
    rowIndex++;
  });

  // PAGE 4: Category Summary
  doc.addPage();
  addPageHeader("Expenses by Category");
  yPosition = 50;

  doc.setTextColor(...textColor);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Summary by Medical Category", margin, yPosition);
  yPosition += 15;

  // Category table header
  doc.setFillColor(...accentColor);
  doc.rect(margin, yPosition - 5, contentWidth, 8, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Category", margin + 2, yPosition);
  doc.text("Total Amount", margin + 120, yPosition);
  doc.text("% of Total", margin + 155, yPosition);
  yPosition += 10;

  // Category rows
  doc.setTextColor(...textColor);
  doc.setFont("helvetica", "normal");
  rowIndex = 0;

  Object.entries(byCategory)
    .sort(([, a], [, b]) => b - a)
    .forEach(([category, amount]) => {
      if (rowIndex % 2 === 0) {
        doc.setFillColor(248, 248, 248);
        doc.rect(margin, yPosition - 5, contentWidth, 7, "F");
      }

      doc.setFontSize(9);
      const categoryText =
        category.length > 40 ? category.substring(0, 40) + "..." : category;
      doc.text(categoryText, margin + 2, yPosition);
      doc.text(`$${amount.toFixed(2)}`, margin + 120, yPosition);
      doc.text(
        `${((amount / totalQualifiedExpenses) * 100).toFixed(1)}%`,
        margin + 155,
        yPosition,
      );

      yPosition += 7;
      rowIndex++;
    });

  // PAGE 5: Receipt Index
  doc.addPage();
  addPageHeader("Receipt & Documentation Index");
  yPosition = 50;

  doc.setTextColor(...textColor);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Supporting Documentation", margin, yPosition);
  yPosition += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const receiptText = doc.splitTextToSize(
    `All ${hsaInvoices.length} qualified medical expenses listed in this report have supporting ` +
      "documentation (receipts, invoices, or explanation of benefits) stored in your Reclaim account. " +
      "These documents are available for download and can be provided to the IRS upon request.",
    contentWidth,
  );
  receiptText.forEach((line: string) => {
    doc.text(line, margin, yPosition);
    yPosition += 6;
  });
  yPosition += 10;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text("IRS Record Retention Requirements:", margin, yPosition);
  yPosition += 8;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const retentionText = [
    "• Keep receipts and documentation for at least 6 years after claiming the deduction",
    "• Documentation must substantiate the medical nature of the expense",
    "• Acceptable documentation includes receipts, invoices, and Explanation of Benefits (EOB)",
    "• Retain records showing the date of service, provider name, and amount paid",
  ];
  retentionText.forEach((line) => {
    doc.text(line, margin, yPosition);
    yPosition += 7;
  });

  // PAGE 6: IRS Compliance & Legal
  doc.addPage();
  addPageHeader("IRS Compliance Information");
  yPosition = 50;

  doc.setTextColor(...textColor);
  doc.setFontSize(12);
  doc.setFont("helvetica", "bold");
  doc.text("Important Tax Information", margin, yPosition);
  yPosition += 15;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  const complianceSections = [
    {
      title: "HSA-Eligible Medical Expenses",
      content:
        "IRS Publication 502 defines qualified medical expenses. This report includes only expenses you marked as HSA-eligible in the Reclaim app. You are responsible for ensuring these expenses meet IRS requirements.",
    },
    {
      title: "Substantiation Requirements",
      content:
        "The IRS requires you to maintain records proving expenses were for medical care. This includes receipts showing the date, provider, description, and amount of each expense. Do not file receipts with your tax return unless specifically requested by the IRS.",
    },
    {
      title: "Distribution Reporting",
      content:
        "You must report all HSA distributions on Form 8889, even if used for qualified medical expenses. Your HSA custodian will provide Form 1099-SA showing total distributions. Compare that amount to the qualified expenses in this report.",
    },
    {
      title: "Tax-Free vs. Taxable Distributions",
      content:
        "HSA distributions for qualified medical expenses are tax-free. Distributions for non-qualified purposes are taxable and may incur a 20% penalty if under age 65. Ensure your withdrawals match documented qualified expenses.",
    },
  ];

  complianceSections.forEach((section) => {
    checkPageBreak(25);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(section.title, margin, yPosition);
    yPosition += 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(section.content, contentWidth);
    lines.forEach((line: string) => {
      doc.text(line, margin, yPosition);
      yPosition += 5;
    });
    yPosition += 8;
  });

  // Legal Disclaimer
  checkPageBreak(40);
  yPosition += 10;
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, yPosition, contentWidth, 35, "F");
  yPosition += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Legal Disclaimer", margin + 5, yPosition);
  yPosition += 7;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const disclaimerLines = doc.splitTextToSize(
    "This report is provided for informational purposes only and does not constitute tax, legal, or financial advice. " +
      "Reclaim is not a tax preparation service. The information in this report is based on data you entered into the Reclaim " +
      "application. You are solely responsible for the accuracy and completeness of this information and for ensuring compliance " +
      "with all applicable tax laws. Please consult a qualified tax professional regarding your specific tax situation and to verify " +
      "that your HSA usage complies with IRS regulations.",
    contentWidth - 10,
  );
  disclaimerLines.forEach((line: string) => {
    doc.text(line, margin + 5, yPosition);
    yPosition += 4;
  });

  // Footer on last page
  yPosition = pageHeight - 20;
  doc.setFontSize(8);
  doc.setTextColor(128, 128, 128);
  doc.text(
    `Generated by Reclaim on ${format(new Date(), "MMMM d, yyyy")}`,
    margin,
    yPosition,
  );
  doc.text(
    "For questions, visit wellth.app",
    pageWidth - margin - 40,
    yPosition,
  );

  return doc.output("blob");
};

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.58.0";

const allowedOrigins = [
  "https://reclaim.health",
  "https://www.reclaim.health",
  "https://wellth-ai.app",
  "https://www.wellth-ai.app",
  Deno.env.get("ALLOWED_ORIGIN"),
].filter(Boolean);

function getCorsHeaders(requestOrigin: string | null) {
  const origin =
    requestOrigin && allowedOrigins.includes(requestOrigin)
      ? requestOrigin
      : allowedOrigins[1];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
  };
}

const ALLOWED_PRICING_DOMAINS = [
  "data.cms.gov",
  "download.cms.gov",
  "www.cms.gov",
];

interface CMSHospitalPricing {
  hospital_name: string;
  last_updated_on: string;
  version: string;
  location_name?: string[];
  hospital_address?: any[];
  license_information?: any;
  type_2_npi?: string[];
  standard_charge_information: StandardChargeItem[];
}

interface StandardChargeItem {
  description: string;
  drug_information?: {
    unit?: number;
    type?: string;
  };
  code_information: CodeInfo[];
  standard_charges: StandardCharge[];
}

interface CodeInfo {
  code: string;
  type: string;
}

interface StandardCharge {
  setting?: string;
  minimum?: number;
  maximum?: number;
  gross_charge?: number;
  discounted_cash?: number;
  modifier_code?: string[];
  payers_information?: PayerInfo[];
  billing_class?: string;
  additional_generic_notes?: string;
}

interface PayerInfo {
  payer_name: string;
  plan_name?: string;
  standard_charge_dollar?: number;
  standard_charge_percentage?: number;
  standard_charge_algorithm?: string;
  median_amount?: number;
  "10th_percentile"?: number;
  "90th_percentile"?: number;
  count?: string;
  methodology?: string;
  additional_payer_notes?: string;
}

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin"));
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require authentication
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  const authClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
  );
  const {
    data: { user },
    error: authError,
  } = await authClient.auth.getUser(authHeader.replace("Bearer ", ""));
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { hospitalPricingUrl, cmsId } = await req.json();

    if (!hospitalPricingUrl || !cmsId) {
      throw new Error(
        "Missing required parameters: hospitalPricingUrl and cmsId",
      );
    }

    // Validate URL to prevent SSRF
    const parsedUrl = new URL(hospitalPricingUrl);
    if (parsedUrl.protocol !== "https:") {
      return new Response(
        JSON.stringify({ error: "Only HTTPS URLs are permitted" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (
      !ALLOWED_PRICING_DOMAINS.some(
        (d) => parsedUrl.hostname === d || parsedUrl.hostname.endsWith("." + d),
      )
    ) {
      return new Response(
        JSON.stringify({ error: "URL domain not permitted" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    console.log(
      `Fetching pricing data for hospital ${cmsId} from ${hospitalPricingUrl}`,
    );

    // Fetch the CMS pricing file
    // Note: CMS files can be VERY large (gigabytes), so we'll implement streaming/chunking
    const response = await fetch(hospitalPricingUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch pricing data: ${response.statusText}`);
    }

    const pricingData: CMSHospitalPricing = await response.json();

    // Extract hospital metadata
    const hospitalData = {
      cms_id: cmsId,
      name: pricingData.hospital_name,
      location_name: pricingData.location_name || [],
      address: pricingData.hospital_address
        ? JSON.stringify(pricingData.hospital_address[0])
        : null,
      city: pricingData.hospital_address?.[0]?.city || null,
      state: pricingData.hospital_address?.[0]?.state || null,
      zip: pricingData.hospital_address?.[0]?.zip || null,
      license_information: pricingData.license_information
        ? JSON.stringify(pricingData.license_information)
        : null,
      type_2_npi: pricingData.type_2_npi || [],
      pricing_file_url: hospitalPricingUrl,
      last_updated: new Date(pricingData.last_updated_on),
    };

    // Upsert hospital record
    const { data: hospital, error: hospitalError } = await supabase
      .from("hospitals")
      .upsert(hospitalData, { onConflict: "cms_id" })
      .select()
      .single();

    if (hospitalError) {
      console.error("Error upserting hospital:", hospitalError);
      throw hospitalError;
    }

    console.log(`Hospital record created/updated: ${hospital.id}`);

    // Process pricing data in batches to avoid memory issues
    const batchSize = 100;
    let processedCount = 0;
    let insertedCount = 0;

    for (
      let i = 0;
      i < pricingData.standard_charge_information.length;
      i += batchSize
    ) {
      const batch = pricingData.standard_charge_information.slice(
        i,
        i + batchSize,
      );
      const pricingRecords = [];

      for (const item of batch) {
        // Each item can have multiple codes and multiple standard charges
        for (const codeInfo of item.code_information || []) {
          for (const charge of item.standard_charges || []) {
            // Create a base record for this code/charge combination
            const baseRecord = {
              hospital_id: hospital.id,
              description: item.description,
              setting: charge.setting || null,
              billing_class: charge.billing_class || null,
              code: codeInfo.code,
              code_type: codeInfo.type,
              modifier_codes: charge.modifier_code || [],
              drug_unit: item.drug_information?.unit || null,
              drug_type: item.drug_information?.type || null,
              gross_charge: charge.gross_charge || null,
              discounted_cash_price: charge.discounted_cash || null,
              min_negotiated_charge: charge.minimum || null,
              max_negotiated_charge: charge.maximum || null,
              additional_generic_notes: charge.additional_generic_notes || null,
            };

            // If there are payer-specific rates, create a record for each payer
            if (
              charge.payers_information &&
              charge.payers_information.length > 0
            ) {
              for (const payer of charge.payers_information) {
                pricingRecords.push({
                  ...baseRecord,
                  payer_name: payer.payer_name,
                  plan_name: payer.plan_name || null,
                  negotiated_rate: payer.standard_charge_dollar || null,
                  negotiated_percentage:
                    payer.standard_charge_percentage || null,
                  negotiated_algorithm: payer.standard_charge_algorithm || null,
                  median_allowed_amount: payer.median_amount || null,
                  percentile_10_amount: payer["10th_percentile"] || null,
                  percentile_90_amount: payer["90th_percentile"] || null,
                  claim_count: payer.count || null,
                  methodology: payer.methodology || null,
                  additional_payer_notes: payer.additional_payer_notes || null,
                });
              }
            } else {
              // No payer-specific info, just insert the base record
              pricingRecords.push({
                ...baseRecord,
                payer_name: null,
                plan_name: null,
                negotiated_rate: null,
                negotiated_percentage: null,
                negotiated_algorithm: null,
                median_allowed_amount: null,
                percentile_10_amount: null,
                percentile_90_amount: null,
                claim_count: null,
                methodology: null,
                additional_payer_notes: null,
              });
            }
          }
        }
      }

      // Insert batch
      if (pricingRecords.length > 0) {
        const { error: pricingError } = await supabase
          .from("hospital_pricing")
          .insert(pricingRecords);

        if (pricingError) {
          console.error("Error inserting pricing batch:", pricingError);
          // Continue processing other batches even if one fails
        } else {
          insertedCount += pricingRecords.length;
        }
      }

      processedCount += batch.length;
      console.log(
        `Processed ${processedCount}/${pricingData.standard_charge_information.length} items (${insertedCount} pricing records inserted)`,
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        hospital_id: hospital.id,
        hospital_name: hospital.name,
        processed_items: processedCount,
        inserted_records: insertedCount,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    console.error("Error in fetch-hospital-pricing:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      },
    );
  }
});

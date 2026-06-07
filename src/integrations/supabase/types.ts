export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]
export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      analytics_events: {
        Row: {
          created_at: string | null
          event_name: string
          event_properties: Json | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          event_name: string
          event_properties?: Json | null
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          event_name?: string
          event_properties?: Json | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      collections: {
        Row: {
          color: string | null
          created_at: string | null
          description: string | null
          hsa_eligible_amount: number | null
          icon: string | null
          id: string
          title: string
          total_billed: number | null
          total_paid: number | null
          updated_at: string | null
          user_id: string
          user_responsibility_override: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          hsa_eligible_amount?: number | null
          icon?: string | null
          id?: string
          title: string
          total_billed?: number | null
          total_paid?: number | null
          updated_at?: string | null
          user_id: string
          user_responsibility_override?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          description?: string | null
          hsa_eligible_amount?: number | null
          icon?: string | null
          id?: string
          title?: string
          total_billed?: number | null
          total_paid?: number | null
          updated_at?: string | null
          user_id?: string
          user_responsibility_override?: number | null
        }
        Relationships: []
      }
      expense_decisions: {
        Row: {
          created_at: string | null
          expense_amount: number
          id: string
          payment_strategy: Json
          used_for_expense_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          expense_amount: number
          id?: string
          payment_strategy: Json
          used_for_expense_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          expense_amount?: number
          id?: string
          payment_strategy?: Json
          used_for_expense_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expense_decisions_used_for_expense_id_fkey"
            columns: ["used_for_expense_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      hospital_pricing: {
        Row: {
          additional_generic_notes: string | null
          additional_payer_notes: string | null
          billing_class: string | null
          claim_count: string | null
          code: string
          code_type: string
          created_at: string | null
          description: string
          discounted_cash_price: number | null
          drug_type: string | null
          drug_unit: number | null
          gross_charge: number | null
          hospital_id: string | null
          id: string
          last_updated: string | null
          max_negotiated_charge: number | null
          median_allowed_amount: number | null
          methodology: string | null
          min_negotiated_charge: number | null
          modifier_codes: string[] | null
          negotiated_algorithm: string | null
          negotiated_percentage: number | null
          negotiated_rate: number | null
          payer_name: string | null
          percentile_10_amount: number | null
          percentile_90_amount: number | null
          plan_name: string | null
          setting: string | null
        }
        Insert: {
          additional_generic_notes?: string | null
          additional_payer_notes?: string | null
          billing_class?: string | null
          claim_count?: string | null
          code: string
          code_type: string
          created_at?: string | null
          description: string
          discounted_cash_price?: number | null
          drug_type?: string | null
          drug_unit?: number | null
          gross_charge?: number | null
          hospital_id?: string | null
          id?: string
          last_updated?: string | null
          max_negotiated_charge?: number | null
          median_allowed_amount?: number | null
          methodology?: string | null
          min_negotiated_charge?: number | null
          modifier_codes?: string[] | null
          negotiated_algorithm?: string | null
          negotiated_percentage?: number | null
          negotiated_rate?: number | null
          payer_name?: string | null
          percentile_10_amount?: number | null
          percentile_90_amount?: number | null
          plan_name?: string | null
          setting?: string | null
        }
        Update: {
          additional_generic_notes?: string | null
          additional_payer_notes?: string | null
          billing_class?: string | null
          claim_count?: string | null
          code?: string
          code_type?: string
          created_at?: string | null
          description?: string
          discounted_cash_price?: number | null
          drug_type?: string | null
          drug_unit?: number | null
          gross_charge?: number | null
          hospital_id?: string | null
          id?: string
          last_updated?: string | null
          max_negotiated_charge?: number | null
          median_allowed_amount?: number | null
          methodology?: string | null
          min_negotiated_charge?: number | null
          modifier_codes?: string[] | null
          negotiated_algorithm?: string | null
          negotiated_percentage?: number | null
          negotiated_rate?: number | null
          payer_name?: string | null
          percentile_10_amount?: number | null
          percentile_90_amount?: number | null
          plan_name?: string | null
          setting?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "hospital_pricing_hospital_id_fkey"
            columns: ["hospital_id"]
            isOneToOne: false
            referencedRelation: "hospitals"
            referencedColumns: ["id"]
          },
        ]
      }
      hospitals: {
        Row: {
          address: Json | null
          city: string | null
          cms_id: string
          created_at: string | null
          id: string
          last_updated: string | null
          license_information: Json | null
          location_name: string[] | null
          name: string
          pricing_file_url: string | null
          state: string | null
          type_2_npi: string[] | null
          zip: string | null
        }
        Insert: {
          address?: Json | null
          city?: string | null
          cms_id: string
          created_at?: string | null
          id?: string
          last_updated?: string | null
          license_information?: Json | null
          location_name?: string[] | null
          name: string
          pricing_file_url?: string | null
          state?: string | null
          type_2_npi?: string[] | null
          zip?: string | null
        }
        Update: {
          address?: Json | null
          city?: string | null
          cms_id?: string
          created_at?: string | null
          id?: string
          last_updated?: string | null
          license_information?: Json | null
          location_name?: string[] | null
          name?: string
          pricing_file_url?: string | null
          state?: string | null
          type_2_npi?: string[] | null
          zip?: string | null
        }
        Relationships: []
      }
      hsa_accounts: {
        Row: {
          account_name: string
          closed_date: string | null
          created_at: string | null
          eligibility_start_date: string | null
          id: string
          is_active: boolean | null
          notes: string | null
          opened_date: string
          qle_type: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_name: string
          closed_date?: string | null
          created_at?: string | null
          eligibility_start_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          opened_date: string
          qle_type?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_name?: string
          closed_date?: string | null
          created_at?: string | null
          eligibility_start_date?: string | null
          id?: string
          is_active?: boolean | null
          notes?: string | null
          opened_date?: string
          qle_type?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "hsa_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_labels: {
        Row: {
          created_at: string
          id: string
          invoice_id: string
          label_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invoice_id: string
          label_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invoice_id?: string
          label_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_labels_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          amount: number
          card_payoff_months: number | null
          category: string
          classification_confidence: number | null
          classification_reasoning: string | null
          classification_warnings: Json
          classified_at: string | null
          collection_id: string | null
          confirmed_at: string | null
          created_at: string
          date: string
          deductible_met: boolean | null
          deductible_portion: number | null
          eligibility_basis_rule_id: string | null
          hsa_account_id: string | null
          id: string
          insurance_plan_name: string | null
          insurance_plan_type: string | null
          investment_notes: string | null
          invoice_date: string | null
          invoice_number: string | null
          is_hsa_eligible: boolean | null
          is_reimbursed: boolean | null
          lifecycle_status: Database["public"]["Enums"]["invoice_lifecycle_status"]
          network_status: string | null
          notes: string | null
          npi_number: string | null
          patient_name: string | null
          payment_method_id: string | null
          payment_plan_installments: number | null
          payment_plan_notes: string | null
          payment_plan_total_amount: number | null
          planned_reimbursement_date: string | null
          reimbursed_at: string | null
          reimbursement_reminder_date: string | null
          reimbursement_strategy: string | null
          source_plaid_transaction_id: string | null
          submitted_at: string | null
          submitted_record_id: string | null
          total_amount: number | null
          updated_at: string
          user_id: string
          user_responsibility_amount: number | null
          vendor: string
        }
        Insert: {
          amount: number
          card_payoff_months?: number | null
          category: string
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classification_warnings?: Json
          classified_at?: string | null
          collection_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          date: string
          deductible_met?: boolean | null
          deductible_portion?: number | null
          eligibility_basis_rule_id?: string | null
          hsa_account_id?: string | null
          id?: string
          insurance_plan_name?: string | null
          insurance_plan_type?: string | null
          investment_notes?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_hsa_eligible?: boolean | null
          is_reimbursed?: boolean | null
          lifecycle_status?: Database["public"]["Enums"]["invoice_lifecycle_status"]
          network_status?: string | null
          notes?: string | null
          npi_number?: string | null
          patient_name?: string | null
          payment_method_id?: string | null
          payment_plan_installments?: number | null
          payment_plan_notes?: string | null
          payment_plan_total_amount?: number | null
          planned_reimbursement_date?: string | null
          reimbursed_at?: string | null
          reimbursement_reminder_date?: string | null
          reimbursement_strategy?: string | null
          source_plaid_transaction_id?: string | null
          submitted_at?: string | null
          submitted_record_id?: string | null
          total_amount?: number | null
          updated_at?: string
          user_id: string
          user_responsibility_amount?: number | null
          vendor: string
        }
        Update: {
          amount?: number
          card_payoff_months?: number | null
          category?: string
          classification_confidence?: number | null
          classification_reasoning?: string | null
          classification_warnings?: Json
          classified_at?: string | null
          collection_id?: string | null
          confirmed_at?: string | null
          created_at?: string
          date?: string
          deductible_met?: boolean | null
          deductible_portion?: number | null
          eligibility_basis_rule_id?: string | null
          hsa_account_id?: string | null
          id?: string
          insurance_plan_name?: string | null
          insurance_plan_type?: string | null
          investment_notes?: string | null
          invoice_date?: string | null
          invoice_number?: string | null
          is_hsa_eligible?: boolean | null
          is_reimbursed?: boolean | null
          lifecycle_status?: Database["public"]["Enums"]["invoice_lifecycle_status"]
          network_status?: string | null
          notes?: string | null
          npi_number?: string | null
          patient_name?: string | null
          payment_method_id?: string | null
          payment_plan_installments?: number | null
          payment_plan_notes?: string | null
          payment_plan_total_amount?: number | null
          planned_reimbursement_date?: string | null
          reimbursed_at?: string | null
          reimbursement_reminder_date?: string | null
          reimbursement_strategy?: string | null
          source_plaid_transaction_id?: string | null
          submitted_at?: string | null
          submitted_record_id?: string | null
          total_amount?: number | null
          updated_at?: string
          user_id?: string
          user_responsibility_amount?: number | null
          vendor?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_eligibility_basis_rule_id_fkey"
            columns: ["eligibility_basis_rule_id"]
            isOneToOne: false
            referencedRelation: "pub_502_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_hsa_account_id_fkey"
            columns: ["hsa_account_id"]
            isOneToOne: false
            referencedRelation: "hsa_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_medical_event_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_submitted_record_id_fkey"
            columns: ["submitted_record_id"]
            isOneToOne: false
            referencedRelation: "substantiation_records"
            referencedColumns: ["id"]
          },
        ]
      }
      labels: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      mcc_codes: {
        Row: {
          code: string
          created_at: string
          default_pub_502_rule_id: string | null
          description: string
          irs_category: string | null
          is_medical: boolean
          notes: string | null
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          default_pub_502_rule_id?: string | null
          description: string
          irs_category?: string | null
          is_medical?: boolean
          notes?: string | null
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          default_pub_502_rule_id?: string | null
          description?: string
          irs_category?: string | null
          is_medical?: boolean
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mcc_codes_default_pub_502_rule_id_fkey"
            columns: ["default_pub_502_rule_id"]
            isOneToOne: false
            referencedRelation: "pub_502_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_labels: {
        Row: {
          created_at: string
          id: string
          label_id: string
          payment_transaction_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          label_id: string
          payment_transaction_id: string
        }
        Update: {
          created_at?: string
          id?: string
          label_id?: string
          payment_transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_labels_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          id: string
          is_hsa_account: boolean
          name: string
          rewards_rate: number | null
          type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_hsa_account?: boolean
          name: string
          rewards_rate?: number | null
          type: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_hsa_account?: boolean
          name?: string
          rewards_rate?: number | null
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_transactions: {
        Row: {
          amount: number
          created_at: string
          hsa_account_id: string | null
          id: string
          invoice_id: string
          is_reimbursed: boolean
          notes: string | null
          payment_date: string
          payment_method_id: string | null
          payment_source: string
          plaid_transaction_id: string | null
          reimbursed_date: string | null
          reimbursement_request_id: string | null
          transaction_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          hsa_account_id?: string | null
          id?: string
          invoice_id: string
          is_reimbursed?: boolean
          notes?: string | null
          payment_date: string
          payment_method_id?: string | null
          payment_source: string
          plaid_transaction_id?: string | null
          reimbursed_date?: string | null
          reimbursement_request_id?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          hsa_account_id?: string | null
          id?: string
          invoice_id?: string
          is_reimbursed?: boolean
          notes?: string | null
          payment_date?: string
          payment_method_id?: string | null
          payment_source?: string
          plaid_transaction_id?: string | null
          reimbursed_date?: string | null
          reimbursement_request_id?: string | null
          transaction_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_transactions_expense_report_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_hsa_account_id_fkey"
            columns: ["hsa_account_id"]
            isOneToOne: false
            referencedRelation: "hsa_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_reimbursement_request_id_fkey"
            columns: ["reimbursement_request_id"]
            isOneToOne: false
            referencedRelation: "reimbursement_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "payment_transactions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      plaid_connections: {
        Row: {
          created_at: string
          encrypted_access_token: string
          first_sync_completed_at: string | null
          id: string
          initial_medical_count: number | null
          initial_total_count: number | null
          institution_name: string | null
          item_id: string
          last_synced_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          encrypted_access_token: string
          first_sync_completed_at?: string | null
          id?: string
          initial_medical_count?: number | null
          initial_total_count?: number | null
          institution_name?: string | null
          item_id: string
          last_synced_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          encrypted_access_token?: string
          first_sync_completed_at?: string | null
          id?: string
          initial_medical_count?: number | null
          initial_total_count?: number | null
          institution_name?: string | null
          item_id?: string
          last_synced_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      procedure_insights: {
        Row: {
          average_patient_cost: number
          cpt_code: string
          created_at: string | null
          fair_price_indicator: string | null
          id: string
          median_patient_cost: number | null
          procedure_category: string | null
          procedure_name: string
          provider_id: string | null
          times_performed: number | null
          typical_insurance_payment: number | null
          updated_at: string | null
        }
        Insert: {
          average_patient_cost: number
          cpt_code: string
          created_at?: string | null
          fair_price_indicator?: string | null
          id?: string
          median_patient_cost?: number | null
          procedure_category?: string | null
          procedure_name: string
          provider_id?: string | null
          times_performed?: number | null
          typical_insurance_payment?: number | null
          updated_at?: string | null
        }
        Update: {
          average_patient_cost?: number
          cpt_code?: string
          created_at?: string | null
          fair_price_indicator?: string | null
          id?: string
          median_patient_cost?: number | null
          procedure_category?: string | null
          procedure_name?: string
          provider_id?: string | null
          times_performed?: number | null
          typical_insurance_payment?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "procedure_insights_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string | null
          has_hsa: boolean | null
          has_seen_insurance_prompt: boolean | null
          hsa_opened_date: string | null
          id: string
          insurance_plan: Json | null
          is_admin: boolean | null
          privacy_policy_version_accepted: string | null
          reimbursement_strategy_preference: string
          terms_accepted_at: string | null
          updated_at: string
          user_intent: string | null
        }
        Insert: {
          created_at?: string
          full_name?: string | null
          has_hsa?: boolean | null
          has_seen_insurance_prompt?: boolean | null
          hsa_opened_date?: string | null
          id: string
          insurance_plan?: Json | null
          is_admin?: boolean | null
          privacy_policy_version_accepted?: string | null
          reimbursement_strategy_preference?: string
          terms_accepted_at?: string | null
          updated_at?: string
          user_intent?: string | null
        }
        Update: {
          created_at?: string
          full_name?: string | null
          has_hsa?: boolean | null
          has_seen_insurance_prompt?: boolean | null
          hsa_opened_date?: string | null
          id?: string
          insurance_plan?: Json | null
          is_admin?: boolean | null
          privacy_policy_version_accepted?: string | null
          reimbursement_strategy_preference?: string
          terms_accepted_at?: string | null
          updated_at?: string
          user_intent?: string | null
        }
        Relationships: []
      }
      provider_bills: {
        Row: {
          bill_amount: number
          bill_review_id: string | null
          confirmed_errors: Json | null
          created_at: string
          deductible_met: boolean | null
          dispute_outcome: string | null
          error_confirmed_at: string | null
          error_confirmed_by_user: boolean | null
          error_flagged_at: string | null
          errors_found: number | null
          id: string
          insurance_plan_type: string | null
          invoice_id: string
          network_status: string | null
          overcharge_amount: number | null
          provider_id: string
          was_disputed: boolean | null
        }
        Insert: {
          bill_amount: number
          bill_review_id?: string | null
          confirmed_errors?: Json | null
          created_at?: string
          deductible_met?: boolean | null
          dispute_outcome?: string | null
          error_confirmed_at?: string | null
          error_confirmed_by_user?: boolean | null
          error_flagged_at?: string | null
          errors_found?: number | null
          id?: string
          insurance_plan_type?: string | null
          invoice_id: string
          network_status?: string | null
          overcharge_amount?: number | null
          provider_id: string
          was_disputed?: boolean | null
        }
        Update: {
          bill_amount?: number
          bill_review_id?: string | null
          confirmed_errors?: Json | null
          created_at?: string
          deductible_met?: boolean | null
          dispute_outcome?: string | null
          error_confirmed_at?: string | null
          error_confirmed_by_user?: boolean | null
          error_flagged_at?: string | null
          errors_found?: number | null
          id?: string
          insurance_plan_type?: string | null
          invoice_id?: string
          network_status?: string | null
          overcharge_amount?: number | null
          provider_id?: string
          was_disputed?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_bills_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_bills_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_charge_benchmarks: {
        Row: {
          average_charge: number
          cpt_code: string
          id: string
          last_updated: string
          max_charge: number | null
          median_charge: number | null
          medicare_rate: number | null
          min_charge: number | null
          procedure_name: string | null
          provider_id: string
          sample_size: number | null
          variance_from_medicare: number | null
          variance_from_national: number | null
        }
        Insert: {
          average_charge: number
          cpt_code: string
          id?: string
          last_updated?: string
          max_charge?: number | null
          median_charge?: number | null
          medicare_rate?: number | null
          min_charge?: number | null
          procedure_name?: string | null
          provider_id: string
          sample_size?: number | null
          variance_from_medicare?: number | null
          variance_from_national?: number | null
        }
        Update: {
          average_charge?: number
          cpt_code?: string
          id?: string
          last_updated?: string
          max_charge?: number | null
          median_charge?: number | null
          medicare_rate?: number | null
          min_charge?: number | null
          procedure_name?: string | null
          provider_id?: string
          sample_size?: number | null
          variance_from_medicare?: number | null
          variance_from_national?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_charge_benchmarks_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_reviews: {
        Row: {
          billing_clarity_rating: number
          cost_transparency_rating: number
          created_at: string | null
          deductible_met: boolean | null
          flagged_reason: string | null
          id: string
          insurance_plan_type: string | null
          invoice_id: string
          is_flagged: boolean | null
          is_verified_patient: boolean | null
          network_status: string | null
          overall_experience_rating: number
          payment_flexibility_rating: number
          procedure_category: string | null
          provider_id: string
          review_text: string | null
          updated_at: string | null
          user_id: string
          would_recommend: boolean | null
        }
        Insert: {
          billing_clarity_rating: number
          cost_transparency_rating: number
          created_at?: string | null
          deductible_met?: boolean | null
          flagged_reason?: string | null
          id?: string
          insurance_plan_type?: string | null
          invoice_id: string
          is_flagged?: boolean | null
          is_verified_patient?: boolean | null
          network_status?: string | null
          overall_experience_rating: number
          payment_flexibility_rating: number
          procedure_category?: string | null
          provider_id: string
          review_text?: string | null
          updated_at?: string | null
          user_id: string
          would_recommend?: boolean | null
        }
        Update: {
          billing_clarity_rating?: number
          cost_transparency_rating?: number
          created_at?: string | null
          deductible_met?: boolean | null
          flagged_reason?: string | null
          id?: string
          insurance_plan_type?: string | null
          invoice_id?: string
          is_flagged?: boolean | null
          is_verified_patient?: boolean | null
          network_status?: string | null
          overall_experience_rating?: number
          payment_flexibility_rating?: number
          procedure_category?: string | null
          provider_id?: string
          review_text?: string | null
          updated_at?: string | null
          user_id?: string
          would_recommend?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_reviews_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_reviews_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "providers"
            referencedColumns: ["id"]
          },
        ]
      }
      providers: {
        Row: {
          accuracy_rating: number | null
          address: string | null
          average_bill_amount: number | null
          billing_accuracy_score: number | null
          billing_clarity_score: number | null
          city: string | null
          cost_rating: number | null
          cost_transparency_score: number | null
          created_at: string
          data_last_updated: string | null
          disputes_lost: number | null
          disputes_won: number | null
          fair_pricing_score: number | null
          id: string
          insurance_networks: string[] | null
          most_common_procedures: Json | null
          name: string
          network_status: string | null
          npi_number: string | null
          overall_rating: number | null
          payment_flexibility_score: number | null
          phone: string | null
          provider_type: string | null
          regional_pricing_percentile: number | null
          response_rating: number | null
          specialties: string[] | null
          specialties_verified: boolean | null
          state: string | null
          tax_id: string | null
          total_bills_analyzed: number | null
          total_disputes_filed: number | null
          total_overcharges_found: number | null
          total_reviews: number | null
          transparency_score: number | null
          updated_at: string
          verified_patient_reviews: number | null
          website: string | null
          zip_code: string | null
        }
        Insert: {
          accuracy_rating?: number | null
          address?: string | null
          average_bill_amount?: number | null
          billing_accuracy_score?: number | null
          billing_clarity_score?: number | null
          city?: string | null
          cost_rating?: number | null
          cost_transparency_score?: number | null
          created_at?: string
          data_last_updated?: string | null
          disputes_lost?: number | null
          disputes_won?: number | null
          fair_pricing_score?: number | null
          id?: string
          insurance_networks?: string[] | null
          most_common_procedures?: Json | null
          name: string
          network_status?: string | null
          npi_number?: string | null
          overall_rating?: number | null
          payment_flexibility_score?: number | null
          phone?: string | null
          provider_type?: string | null
          regional_pricing_percentile?: number | null
          response_rating?: number | null
          specialties?: string[] | null
          specialties_verified?: boolean | null
          state?: string | null
          tax_id?: string | null
          total_bills_analyzed?: number | null
          total_disputes_filed?: number | null
          total_overcharges_found?: number | null
          total_reviews?: number | null
          transparency_score?: number | null
          updated_at?: string
          verified_patient_reviews?: number | null
          website?: string | null
          zip_code?: string | null
        }
        Update: {
          accuracy_rating?: number | null
          address?: string | null
          average_bill_amount?: number | null
          billing_accuracy_score?: number | null
          billing_clarity_score?: number | null
          city?: string | null
          cost_rating?: number | null
          cost_transparency_score?: number | null
          created_at?: string
          data_last_updated?: string | null
          disputes_lost?: number | null
          disputes_won?: number | null
          fair_pricing_score?: number | null
          id?: string
          insurance_networks?: string[] | null
          most_common_procedures?: Json | null
          name?: string
          network_status?: string | null
          npi_number?: string | null
          overall_rating?: number | null
          payment_flexibility_score?: number | null
          phone?: string | null
          provider_type?: string | null
          regional_pricing_percentile?: number | null
          response_rating?: number | null
          specialties?: string[] | null
          specialties_verified?: boolean | null
          state?: string | null
          tax_id?: string | null
          total_bills_analyzed?: number | null
          total_disputes_filed?: number | null
          total_overcharges_found?: number | null
          total_reviews?: number | null
          transparency_score?: number | null
          updated_at?: string
          verified_patient_reviews?: number | null
          website?: string | null
          zip_code?: string | null
        }
        Relationships: []
      }
      pub_502_rules: {
        Row: {
          category: string
          conditions: string | null
          created_at: string
          effective_year: number | null
          eligibility_status: string
          examples: string[] | null
          id: string
          name: string
          notes: string | null
          section_ref: string | null
          updated_at: string
        }
        Insert: {
          category: string
          conditions?: string | null
          created_at?: string
          effective_year?: number | null
          eligibility_status: string
          examples?: string[] | null
          id: string
          name: string
          notes?: string | null
          section_ref?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          conditions?: string | null
          created_at?: string
          effective_year?: number | null
          eligibility_status?: string
          examples?: string[] | null
          id?: string
          name?: string
          notes?: string | null
          section_ref?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      receipt_labels: {
        Row: {
          id: string
          label_id: string
          receipt_id: string
        }
        Insert: {
          id?: string
          label_id: string
          receipt_id: string
        }
        Update: {
          id?: string
          label_id?: string
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_labels_label_id_fkey"
            columns: ["label_id"]
            isOneToOne: false
            referencedRelation: "labels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipt_labels_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipt_ocr_data: {
        Row: {
          confidence_score: number | null
          extracted_amount: number | null
          extracted_bill_date: string | null
          extracted_category: string | null
          extracted_date: string | null
          extracted_insurance: string | null
          extracted_invoice_number: string | null
          extracted_service_date: string | null
          extracted_vendor: string | null
          extraction_warnings: Json | null
          id: string
          metadata_confidence: number | null
          metadata_full: Json | null
          processed_at: string
          raw_response: string | null
          receipt_id: string
        }
        Insert: {
          confidence_score?: number | null
          extracted_amount?: number | null
          extracted_bill_date?: string | null
          extracted_category?: string | null
          extracted_date?: string | null
          extracted_insurance?: string | null
          extracted_invoice_number?: string | null
          extracted_service_date?: string | null
          extracted_vendor?: string | null
          extraction_warnings?: Json | null
          id?: string
          metadata_confidence?: number | null
          metadata_full?: Json | null
          processed_at?: string
          raw_response?: string | null
          receipt_id: string
        }
        Update: {
          confidence_score?: number | null
          extracted_amount?: number | null
          extracted_bill_date?: string | null
          extracted_category?: string | null
          extracted_date?: string | null
          extracted_insurance?: string | null
          extracted_invoice_number?: string | null
          extracted_service_date?: string | null
          extracted_vendor?: string | null
          extraction_warnings?: Json | null
          id?: string
          metadata_confidence?: number | null
          metadata_full?: Json | null
          processed_at?: string
          raw_response?: string | null
          receipt_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipt_ocr_data_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      receipts: {
        Row: {
          collection_id: string | null
          description: string | null
          display_order: number | null
          document_type: string | null
          file_path: string
          file_type: string
          id: string
          invoice_id: string | null
          payment_transaction_id: string | null
          uploaded_at: string
          user_id: string
        }
        Insert: {
          collection_id?: string | null
          description?: string | null
          display_order?: number | null
          document_type?: string | null
          file_path: string
          file_type: string
          id?: string
          invoice_id?: string | null
          payment_transaction_id?: string | null
          uploaded_at?: string
          user_id: string
        }
        Update: {
          collection_id?: string | null
          description?: string | null
          display_order?: number | null
          document_type?: string | null
          file_path?: string
          file_type?: string
          id?: string
          invoice_id?: string | null
          payment_transaction_id?: string | null
          uploaded_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receipts_expense_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_medical_event_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receipts_payment_transaction_id_fkey"
            columns: ["payment_transaction_id"]
            isOneToOne: false
            referencedRelation: "payment_transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      regional_benchmarks: {
        Row: {
          cpt_code: string
          id: string
          last_updated: string | null
          median_charge: number
          p25_charge: number | null
          p75_charge: number | null
          p90_charge: number | null
          procedure_name: string | null
          region_code: string
          sample_size: number | null
        }
        Insert: {
          cpt_code: string
          id?: string
          last_updated?: string | null
          median_charge: number
          p25_charge?: number | null
          p75_charge?: number | null
          p90_charge?: number | null
          procedure_name?: string | null
          region_code: string
          sample_size?: number | null
        }
        Update: {
          cpt_code?: string
          id?: string
          last_updated?: string | null
          median_charge?: number
          p25_charge?: number | null
          p75_charge?: number | null
          p90_charge?: number | null
          procedure_name?: string | null
          region_code?: string
          sample_size?: number | null
        }
        Relationships: []
      }
      reimbursement_items: {
        Row: {
          id: string
          invoice_id: string
          reimbursement_request_id: string
        }
        Insert: {
          id?: string
          invoice_id: string
          reimbursement_request_id: string
        }
        Update: {
          id?: string
          invoice_id?: string
          reimbursement_request_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reimbursement_items_expense_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_items_reimbursement_request_id_fkey"
            columns: ["reimbursement_request_id"]
            isOneToOne: false
            referencedRelation: "reimbursement_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      reimbursement_match_candidates: {
        Row: {
          created_at: string
          id: string
          match_amount: number
          match_confidence: number
          match_reason: string | null
          resolved_at: string | null
          status: string
          substantiation_record_id: string
          transaction_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          match_amount: number
          match_confidence: number
          match_reason?: string | null
          resolved_at?: string | null
          status?: string
          substantiation_record_id: string
          transaction_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          match_amount?: number
          match_confidence?: number
          match_reason?: string | null
          resolved_at?: string | null
          status?: string
          substantiation_record_id?: string
          transaction_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reimbursement_match_candidates_substantiation_record_id_fkey"
            columns: ["substantiation_record_id"]
            isOneToOne: false
            referencedRelation: "substantiation_records"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reimbursement_match_candidates_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      reimbursement_requests: {
        Row: {
          created_at: string
          hsa_provider: string | null
          id: string
          notes: string | null
          pdf_file_path: string | null
          status: string
          submission_email: string | null
          submission_method: string | null
          submitted_at: string | null
          total_amount: number
          user_id: string
        }
        Insert: {
          created_at?: string
          hsa_provider?: string | null
          id?: string
          notes?: string | null
          pdf_file_path?: string | null
          status?: string
          submission_email?: string | null
          submission_method?: string | null
          submitted_at?: string | null
          total_amount: number
          user_id: string
        }
        Update: {
          created_at?: string
          hsa_provider?: string | null
          id?: string
          notes?: string | null
          pdf_file_path?: string | null
          status?: string
          submission_email?: string | null
          submission_method?: string | null
          submitted_at?: string | null
          total_amount?: number
          user_id?: string
        }
        Relationships: []
      }
      review_moderation_log: {
        Row: {
          action: string
          admin_id: string
          created_at: string
          id: string
          reason: string | null
          review_id: string
        }
        Insert: {
          action: string
          admin_id: string
          created_at?: string
          id?: string
          reason?: string | null
          review_id: string
        }
        Update: {
          action?: string
          admin_id?: string
          created_at?: string
          id?: string
          reason?: string | null
          review_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "review_moderation_log_review_id_fkey"
            columns: ["review_id"]
            isOneToOne: false
            referencedRelation: "reviews"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          created_at: string | null
          id: string
          is_featured: boolean | null
          moderated_at: string | null
          moderated_by: string | null
          moderation_notes: string | null
          moderation_status: string | null
          rating: number
          review_text: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          is_featured?: boolean | null
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_notes?: string | null
          moderation_status?: string | null
          rating: number
          review_text: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          is_featured?: boolean | null
          moderated_at?: string | null
          moderated_by?: string | null
          moderation_notes?: string | null
          moderation_status?: string | null
          rating?: number
          review_text?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      savings_goals: {
        Row: {
          created_at: string
          current_amount: number
          deadline: string | null
          goal_type: string
          id: string
          is_active: boolean
          target_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_amount?: number
          deadline?: string | null
          goal_type: string
          id?: string
          is_active?: boolean
          target_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_amount?: number
          deadline?: string | null
          goal_type?: string
          id?: string
          is_active?: boolean
          target_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      substantiation_record_items: {
        Row: {
          amount_at_submission: number
          category_at_submission: string | null
          confirmed_at_at_submission: string
          created_at: string
          date_at_submission: string
          eligibility_basis_rule_id_at_submission: string | null
          id: string
          invoice_id: string
          patient_name_at_submission: string | null
          substantiation_record_id: string
          vendor_at_submission: string
        }
        Insert: {
          amount_at_submission: number
          category_at_submission?: string | null
          confirmed_at_at_submission: string
          created_at?: string
          date_at_submission: string
          eligibility_basis_rule_id_at_submission?: string | null
          id?: string
          invoice_id: string
          patient_name_at_submission?: string | null
          substantiation_record_id: string
          vendor_at_submission: string
        }
        Update: {
          amount_at_submission?: number
          category_at_submission?: string | null
          confirmed_at_at_submission?: string
          created_at?: string
          date_at_submission?: string
          eligibility_basis_rule_id_at_submission?: string | null
          id?: string
          invoice_id?: string
          patient_name_at_submission?: string | null
          substantiation_record_id?: string
          vendor_at_submission?: string
        }
        Relationships: [
          {
            foreignKeyName: "substantiation_record_items_eligibility_basis_rule_id_at_s_fkey"
            columns: ["eligibility_basis_rule_id_at_submission"]
            isOneToOne: false
            referencedRelation: "pub_502_rules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "substantiation_record_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "substantiation_record_items_substantiation_record_id_fkey"
            columns: ["substantiation_record_id"]
            isOneToOne: false
            referencedRelation: "substantiation_records"
            referencedColumns: ["id"]
          },
        ]
      }
      substantiation_records: {
        Row: {
          created_at: string
          csv_storage_path: string | null
          expense_count: number
          formats_generated: string[]
          generated_at: string
          id: string
          notes: string | null
          pdf_storage_path: string | null
          record_number: string
          reimbursed_at: string | null
          reimbursed_transaction_id: string | null
          status: string
          tax_year: number
          total_amount: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          csv_storage_path?: string | null
          expense_count: number
          formats_generated?: string[]
          generated_at?: string
          id?: string
          notes?: string | null
          pdf_storage_path?: string | null
          record_number: string
          reimbursed_at?: string | null
          reimbursed_transaction_id?: string | null
          status?: string
          tax_year: number
          total_amount: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          csv_storage_path?: string | null
          expense_count?: number
          formats_generated?: string[]
          generated_at?: string
          id?: string
          notes?: string | null
          pdf_storage_path?: string | null
          record_number?: string
          reimbursed_at?: string | null
          reimbursed_transaction_id?: string | null
          status?: string
          tax_year?: number
          total_amount?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "substantiation_records_reimbursed_transaction_id_fkey"
            columns: ["reimbursed_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_invoice_suggestions: {
        Row: {
          confidence_score: number
          created_at: string
          id: string
          invoice_id: string
          match_reason: string | null
          transaction_id: string
        }
        Insert: {
          confidence_score: number
          created_at?: string
          id?: string
          invoice_id: string
          match_reason?: string | null
          transaction_id: string
        }
        Update: {
          confidence_score?: number
          created_at?: string
          id?: string
          invoice_id?: string
          match_reason?: string | null
          transaction_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_invoice_suggestions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_invoice_suggestions_transaction_id_fkey"
            columns: ["transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_splits: {
        Row: {
          amount: number
          created_at: string
          description: string | null
          hsa_account_id: string | null
          id: string
          notes: string | null
          parent_transaction_id: string
          updated_at: string
        }
        Insert: {
          amount: number
          created_at?: string
          description?: string | null
          hsa_account_id?: string | null
          id?: string
          notes?: string | null
          parent_transaction_id: string
          updated_at?: string
        }
        Update: {
          amount?: number
          created_at?: string
          description?: string | null
          hsa_account_id?: string | null
          id?: string
          notes?: string | null
          parent_transaction_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "transaction_splits_hsa_account_id_fkey"
            columns: ["hsa_account_id"]
            isOneToOne: false
            referencedRelation: "hsa_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_splits_parent_transaction_id_fkey"
            columns: ["parent_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transactions: {
        Row: {
          amount: number
          category: string | null
          created_at: string
          description: string
          id: string
          invoice_id: string | null
          is_hsa_eligible: boolean | null
          is_medical: boolean | null
          is_split: boolean | null
          needs_review: boolean
          notes: string | null
          payment_method_id: string | null
          plaid_transaction_id: string | null
          reconciliation_status: string | null
          source: string | null
          split_parent_id: string | null
          transaction_date: string
          updated_at: string
          user_id: string
          vendor: string | null
        }
        Insert: {
          amount: number
          category?: string | null
          created_at?: string
          description: string
          id?: string
          invoice_id?: string | null
          is_hsa_eligible?: boolean | null
          is_medical?: boolean | null
          is_split?: boolean | null
          needs_review?: boolean
          notes?: string | null
          payment_method_id?: string | null
          plaid_transaction_id?: string | null
          reconciliation_status?: string | null
          source?: string | null
          split_parent_id?: string | null
          transaction_date: string
          updated_at?: string
          user_id: string
          vendor?: string | null
        }
        Update: {
          amount?: number
          category?: string | null
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string | null
          is_hsa_eligible?: boolean | null
          is_medical?: boolean | null
          is_split?: boolean | null
          needs_review?: boolean
          notes?: string | null
          payment_method_id?: string | null
          plaid_transaction_id?: string | null
          reconciliation_status?: string | null
          source?: string | null
          split_parent_id?: string | null
          transaction_date?: string
          updated_at?: string
          user_id?: string
          vendor?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_payment_method_id_fkey"
            columns: ["payment_method_id"]
            isOneToOne: false
            referencedRelation: "payment_methods"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_split_parent_id_fkey"
            columns: ["split_parent_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      transparency_metrics: {
        Row: {
          common_overcharge_trends: Json | null
          created_at: string | null
          id: string
          metric_date: string
          regional_insights: Json | null
          top_overcharging_providers: Json | null
          top_transparent_providers: Json | null
        }
        Insert: {
          common_overcharge_trends?: Json | null
          created_at?: string | null
          id?: string
          metric_date?: string
          regional_insights?: Json | null
          top_overcharging_providers?: Json | null
          top_transparent_providers?: Json | null
        }
        Update: {
          common_overcharge_trends?: Json | null
          created_at?: string | null
          id?: string
          metric_date?: string
          regional_insights?: Json | null
          top_overcharging_providers?: Json | null
          top_transparent_providers?: Json | null
        }
        Relationships: []
      }
      user_vendor_preferences: {
        Row: {
          confidence_score: number | null
          created_at: string
          id: string
          is_medical: boolean
          times_confirmed: number | null
          updated_at: string
          user_id: string
          vendor_pattern: string
        }
        Insert: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_medical?: boolean
          times_confirmed?: number | null
          updated_at?: string
          user_id: string
          vendor_pattern: string
        }
        Update: {
          confidence_score?: number | null
          created_at?: string
          id?: string
          is_medical?: boolean
          times_confirmed?: number | null
          updated_at?: string
          user_id?: string
          vendor_pattern?: string
        }
        Relationships: []
      }
      wellbie_attachments: {
        Row: {
          analysis_result: Json | null
          analysis_status: string | null
          conversation_id: string | null
          created_at: string | null
          file_name: string | null
          file_path: string
          file_size: number | null
          file_type: string
          id: string
          invoice_id: string | null
          message_id: string | null
          receipt_id: string | null
          user_id: string | null
        }
        Insert: {
          analysis_result?: Json | null
          analysis_status?: string | null
          conversation_id?: string | null
          created_at?: string | null
          file_name?: string | null
          file_path: string
          file_size?: number | null
          file_type: string
          id?: string
          invoice_id?: string | null
          message_id?: string | null
          receipt_id?: string | null
          user_id?: string | null
        }
        Update: {
          analysis_result?: Json | null
          analysis_status?: string | null
          conversation_id?: string | null
          created_at?: string | null
          file_name?: string | null
          file_path?: string
          file_size?: number | null
          file_type?: string
          id?: string
          invoice_id?: string | null
          message_id?: string | null
          receipt_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wellbie_attachments_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wellbie_conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellbie_attachments_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellbie_attachments_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "wellbie_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wellbie_attachments_receipt_id_fkey"
            columns: ["receipt_id"]
            isOneToOne: false
            referencedRelation: "receipts"
            referencedColumns: ["id"]
          },
        ]
      }
      wellbie_conversations: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      wellbie_messages: {
        Row: {
          content: string
          conversation_id: string
          created_at: string
          id: string
          role: string
        }
        Insert: {
          content: string
          conversation_id: string
          created_at?: string
          id?: string
          role: string
        }
        Update: {
          content?: string
          conversation_id?: string
          created_at?: string
          id?: string
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "wellbie_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "wellbie_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      calculate_fair_pricing_score: {
        Args: { p_provider_id: string }
        Returns: number
      }
      can_view_provider_review: {
        Args: { review_is_flagged: boolean; review_user_id: string }
        Returns: boolean
      }
      update_provider_statistics: {
        Args: { p_provider_id: string }
        Returns: undefined
      }
    }
    Enums: {
      invoice_lifecycle_status:
        | "captured"
        | "pending_review"
        | "eligible"
        | "ineligible"
        | "needs_receipt"
        | "submitted"
        | "reimbursed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}
type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]
export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never
export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never
export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never
export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never
export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never
export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      invoice_lifecycle_status: [
        "captured",
        "pending_review",
        "eligible",
        "ineligible",
        "needs_receipt",
        "submitted",
        "reimbursed",
      ],
    },
  },
} as const
Initialising login role...
A new version of Supabase CLI is available: v2.105.0 (currently installed v2.83.0)
We recommend updating regularly for new features and bug fixes: https://supabase.com/docs/guides/cli/getting-started#updating-the-supabase-cli

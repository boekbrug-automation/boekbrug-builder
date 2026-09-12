// src/types/database.types.ts
// Generated from the database, with hand-written additions — read this before editing.
//
// The bulk of this file comes from `supabase gen types typescript`. Three things were added by
// hand, because the generator could not be run at the time (no Supabase credentials in that
// environment). They match the applied migrations column for column:
//
//   · company_members            — supabase/migrations/company_members_sales_role.sql
//   · company_member_invites     — same migration
//   · invoices.created_by        — same migration (uuid, nullable, FK → profiles.id)
//   · clients.created_by         — same migration
//   · invoice_lines.unit         — supabase/migrations/invoice_line_unit.sql (text, nullable)
//   · accountant_directory       — supabase/migrations/accountant_directory.sql ([KANTOORGIDS])
//   · bank_connections           — supabase/migrations/bank_connections.sql
//   · bank_connection_accounts   — same migration (incl. identification_hash, [EB-ACCOUNT-IDENTITY])
//   · bank_transactions.source        — supabase/migrations/bank_tx_source_identity.sql (text, nullable)
//   · bank_transactions.external_id   — same migration (text, nullable)
//   · profiles.vat_exempt_activity / .vat_exempt_since,
//   · profiles.vat_statement_note (vat_statement_note.sql — [BTW-VERKLARING]),
//   · feedback + supplier_aliases (whole tables),
//     suppliers.auto_incasso / .auto_incasso_since / .incasso_suggested_at,
//     bank_transactions.type_code / .mandate_id / .creditor_id — all added by hand once their
//     migrations were applied, so the COMPILER checks those column names instead of `as any`
//     letting a typo through to runtime. Note which table each one is on: auto_incasso and
//     incasso_suggested_at are on SUPPLIERS, not on profiles or bank_transactions.
//     invoice_lines.vat_treatment, invoices.vat_deduction
//   · time_entries               — supabase/migrations/urenregistratie.sql (whole table, [UREN])
//                                 — supabase/migrations/vat_exemption.sql
//
// WHY THAT MATTERS. A type here is a CLAIM about the database, not a fact. Get one wrong and tsc
// stays green while the request fails at runtime — exactly how `created_by` once broke invoice
// creation for everyone (see src/lib/created-by.ts). So: when you next regenerate this file,
//
//   supabase gen types typescript --project-id <ref> > src/types/database.types.ts
//
// check that the entries above survive. If the generator drops one, the migration is not
// applied on the database you generated from — fix that, do not re-add the type by hand.
//
// NOTE: src/lib/database.types.ts is an older, unused copy. Nothing imports it. Do not edit it
// expecting an effect.

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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      accountant_directory: {
        Row: {
          accountant_id: string
          accepting_clients: boolean
          city: string
          contact_email: string
          created_at: string
          office_name: string
          published: boolean
          specialisms: string[]
          updated_at: string
          website: string | null
        }
        Insert: {
          accountant_id: string
          accepting_clients?: boolean
          city?: string
          contact_email?: string
          created_at?: string
          office_name?: string
          published?: boolean
          specialisms?: string[]
          updated_at?: string
          website?: string | null
        }
        Update: {
          accountant_id?: string
          accepting_clients?: boolean
          city?: string
          contact_email?: string
          created_at?: string
          office_name?: string
          published?: boolean
          specialisms?: string[]
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountant_directory_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      accountant_clients: {
        Row: {
          accountant_id: string | null
          created_at: string | null
          id: string
          zzper_id: string | null
        }
        Insert: {
          accountant_id?: string | null
          created_at?: string | null
          id?: string
          zzper_id?: string | null
        }
        Update: {
          accountant_id?: string | null
          created_at?: string | null
          id?: string
          zzper_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountant_clients_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "accountant_clients_zzper_id_fkey"
            columns: ["zzper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      // [MANDAAT] Hand-written, from accountant_invoice_mandate.sql. The client's authorisation
      // for their accountant to issue invoices in their name (art. 35 lid 1 Wet OB). Rows are
      // never deleted — revoking sets revoked_at, so the history stays answerable.
      accountant_invoice_mandates: {
        Row: {
          accountant_id: string
          granted_at: string
          id: string
          // [BEVESTIGEN] 'facturen' | 'bevestigen' — two separate decisions by the client, one
          // house. See accountant_confirm_mandate.sql.
          kind: string
          revoked_at: string | null
          revoked_by: string | null
          zzper_id: string
        }
        Insert: {
          accountant_id: string
          granted_at?: string
          id?: string
          kind?: string
          revoked_at?: string | null
          revoked_by?: string | null
          zzper_id: string
        }
        Update: {
          accountant_id?: string
          granted_at?: string
          id?: string
          kind?: string
          revoked_at?: string | null
          revoked_by?: string | null
          zzper_id?: string
        }
        Relationships: []
      }
      accountant_subject_status: {
        Row: {
          accountant_id: string
          created_at: string
          id: string
          status: string
          subject_id: string
          subject_type: string
          updated_at: string
          verwerkt_at: string | null
          vraag_text: string | null
        }
        Insert: {
          accountant_id: string
          created_at?: string
          id?: string
          status?: string
          subject_id: string
          subject_type: string
          updated_at?: string
          verwerkt_at?: string | null
          vraag_text?: string | null
        }
        Update: {
          accountant_id?: string
          created_at?: string
          id?: string
          status?: string
          subject_id?: string
          subject_type?: string
          updated_at?: string
          verwerkt_at?: string | null
          vraag_text?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "accountant_subject_status_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_logs: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string
          id: string
          ip_address: string | null
          new_value: Json | null
          old_value: Json | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          ip_address?: string | null
          new_value?: Json | null
          old_value?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_connections: {
        Row: {
          access_valid_until: string | null
          aspsp_country: string
          aspsp_name: string
          connected_at: string | null
          created_at: string
          id: string
          institution_bic: string | null
          institution_name: string | null
          last_error: string | null
          last_synced_at: string | null
          max_historical_days: number | null
          provider: string
          reference: string
          session_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          access_valid_until?: string | null
          aspsp_country: string
          aspsp_name: string
          connected_at?: string | null
          created_at?: string
          id?: string
          institution_bic?: string | null
          institution_name?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          max_historical_days?: number | null
          provider?: string
          reference: string
          session_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          access_valid_until?: string | null
          aspsp_country?: string
          aspsp_name?: string
          connected_at?: string | null
          created_at?: string
          id?: string
          institution_bic?: string | null
          institution_name?: string | null
          last_error?: string | null
          last_synced_at?: string | null
          max_historical_days?: number | null
          provider?: string
          reference?: string
          session_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_connection_accounts: {
        Row: {
          account_id: string
          identification_hash: string
          connection_id: string
          created_at: string
          currency: string | null
          iban: string | null
          id: string
          last_error: string | null
          last_synced_at: string | null
          last_synced_through: string | null
          owner_name: string | null
          status: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_id: string
          identification_hash: string
          connection_id: string
          created_at?: string
          currency?: string | null
          iban?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          last_synced_through?: string | null
          owner_name?: string | null
          status?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_id?: string
          identification_hash?: string
          connection_id?: string
          created_at?: string
          currency?: string | null
          iban?: string | null
          id?: string
          last_error?: string | null
          last_synced_at?: string | null
          last_synced_through?: string | null
          owner_name?: string | null
          status?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_connection_accounts_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "bank_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_connection_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_transactions: {
        Row: {
          amount: number | null
          category: string | null
          category_confirmed: boolean
          category_source: string | null
          counterpart_iban: string | null
          counterpart_name: string | null
          created_at: string | null
          date: string | null
          description: string | null
          id: string
          invoice_id: string | null
          reference: string | null
          source: string | null
          external_id: string | null
          status: string | null
          statement_document_id: string | null
          user_id: string | null
          type_code: string | null
          mandate_id: string | null
          creditor_id: string | null
        }
        Insert: {
          amount?: number | null
          category?: string | null
          category_confirmed?: boolean
          category_source?: string | null
          counterpart_iban?: string | null
          counterpart_name?: string | null
          created_at?: string | null
          date?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          reference?: string | null
          source?: string | null
          external_id?: string | null
          status?: string | null
          statement_document_id?: string | null
          user_id?: string | null
          type_code?: string | null
          mandate_id?: string | null
          creditor_id?: string | null
        }
        Update: {
          amount?: number | null
          category?: string | null
          category_confirmed?: boolean
          category_source?: string | null
          counterpart_iban?: string | null
          counterpart_name?: string | null
          created_at?: string | null
          date?: string | null
          description?: string | null
          id?: string
          invoice_id?: string | null
          reference?: string | null
          source?: string | null
          external_id?: string | null
          status?: string | null
          statement_document_id?: string | null
          user_id?: string | null
          type_code?: string | null
          mandate_id?: string | null
          creditor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bank_transactions_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bank_transactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_tx_invoices: {
        Row: {
          amount_applied: number | null
          client_key: string | null
          created_at: string | null
          id: string
          invoice_id: string
          method: string | null
          paid_on: string | null
          transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount_applied?: number | null
          client_key?: string | null
          created_at?: string | null
          id?: string
          invoice_id: string
          method?: string | null
          paid_on?: string | null
          transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount_applied?: number | null
          client_key?: string | null
          created_at?: string | null
          id?: string
          invoice_id?: string
          method?: string | null
          paid_on?: string | null
          transaction_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      counterpart_memory: {
        Row: {
          category: string
          counterpart_key: string
          created_at: string | null
          id: string
          last_used_at: string | null
          times_seen: number
          user_id: string
        }
        Insert: {
          category: string
          counterpart_key: string
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          times_seen?: number
          user_id: string
        }
        Update: {
          category?: string
          counterpart_key?: string
          created_at?: string | null
          id?: string
          last_used_at?: string | null
          times_seen?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "counterpart_memory_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      till_sales: {
        Row: {
          article_id: string | null
          btw_rate: number
          created_at: string | null
          description: string
          id: string
          method: string
          quantity: number
          sale_date: string
          ticket_id: string
          unit_price_incl: number
          user_id: string
        }
        Insert: {
          article_id?: string | null
          btw_rate: number
          created_at?: string | null
          description: string
          id?: string
          method: string
          quantity: number
          sale_date?: string
          ticket_id: string
          unit_price_incl: number
          user_id: string
        }
        Update: {
          article_id?: string | null
          btw_rate?: number
          created_at?: string | null
          description?: string
          id?: string
          method?: string
          quantity?: number
          sale_date?: string
          ticket_id?: string
          unit_price_incl?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "till_sales_article_id_fkey"
            columns: ["article_id"]
            isOneToOne: false
            referencedRelation: "articles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "till_sales_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      assets: {
        Row: {
          cost: number
          created_at: string
          description: string
          disposal_note: string | null
          disposed_on: string | null
          id: string
          in_use_from: string
          invoice_id: string | null
          residual_value: number
          updated_at: string
          useful_life_years: number
          user_id: string
        }
        Insert: {
          cost: number
          created_at?: string
          description: string
          disposal_note?: string | null
          disposed_on?: string | null
          id?: string
          in_use_from: string
          invoice_id?: string | null
          residual_value?: number
          updated_at?: string
          useful_life_years: number
          user_id: string
        }
        Update: {
          cost?: number
          created_at?: string
          description?: string
          disposal_note?: string | null
          disposed_on?: string | null
          id?: string
          in_use_from?: string
          invoice_id?: string | null
          residual_value?: number
          updated_at?: string
          useful_life_years?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "assets_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: true
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      asset_dismissals: {
        Row: {
          created_at: string
          invoice_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          invoice_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          invoice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "asset_dismissals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "asset_dismissals_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      vehicles: {
        Row: {
          apk_expiry: string | null
          created_at: string | null
          customer_name: string | null
          customer_phone: string | null
          description: string | null
          id: string
          kenteken: string
          notes: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          apk_expiry?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          id?: string
          kenteken: string
          notes?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          apk_expiry?: string | null
          created_at?: string | null
          customer_name?: string | null
          customer_phone?: string | null
          description?: string | null
          id?: string
          kenteken?: string
          notes?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vehicles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_turnover: {
        Row: {
          base_0: number
          base_21: number
          base_9: number
          btw_21: number
          btw_9: number
          cash_amount: number | null
          created_at: string | null
          document_id: string | null
          id: string
          other_amount: number | null
          pin_amount: number | null
          source: string
          total_incl: number | null
          turnover_date: string
          user_id: string
        }
        Insert: {
          base_0?: number
          base_21?: number
          base_9?: number
          btw_21?: number
          btw_9?: number
          cash_amount?: number | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          other_amount?: number | null
          pin_amount?: number | null
          source?: string
          total_incl?: number | null
          turnover_date: string
          user_id: string
        }
        Update: {
          base_0?: number
          base_21?: number
          base_9?: number
          btw_21?: number
          btw_9?: number
          cash_amount?: number | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          other_amount?: number | null
          pin_amount?: number | null
          source?: string
          total_incl?: number | null
          turnover_date?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "daily_turnover_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "daily_turnover_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      articles: {
        Row: {
          active: boolean
          btw_rate: number
          code: string | null
          created_at: string | null
          description: string
          id: string
          unit: string | null
          unit_price: number
          updated_at: string | null
          usage_count: number
          user_id: string
        }
        Insert: {
          active?: boolean
          btw_rate?: number
          code?: string | null
          created_at?: string | null
          description: string
          id?: string
          unit?: string | null
          unit_price?: number
          updated_at?: string | null
          usage_count?: number
          user_id: string
        }
        Update: {
          active?: boolean
          btw_rate?: number
          code?: string | null
          created_at?: string | null
          description?: string
          id?: string
          unit?: string | null
          unit_price?: number
          updated_at?: string | null
          usage_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "articles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      eft_settlements: {
        Row: {
          by_scheme: Json | null
          created_at: string | null
          document_id: string | null
          first_trx: string | null
          gross_total: number
          id: string
          last_trx: string | null
          period_end: string | null
          period_nr: string | null
          period_start: string | null
          settlement_date: string
          shift_nr: string | null
          source: string
          terminal_id: string | null
          tx_count: number
          user_id: string
        }
        Insert: {
          by_scheme?: Json | null
          created_at?: string | null
          document_id?: string | null
          first_trx?: string | null
          gross_total: number
          id?: string
          last_trx?: string | null
          period_end?: string | null
          period_nr?: string | null
          period_start?: string | null
          settlement_date: string
          shift_nr?: string | null
          source?: string
          terminal_id?: string | null
          tx_count?: number
          user_id: string
        }
        Update: {
          by_scheme?: Json | null
          created_at?: string | null
          document_id?: string | null
          first_trx?: string | null
          gross_total?: number
          id?: string
          last_trx?: string | null
          period_end?: string | null
          period_nr?: string | null
          period_start?: string | null
          settlement_date?: string
          shift_nr?: string | null
          source?: string
          terminal_id?: string | null
          tx_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "eft_settlements_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "eft_settlements_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      cash_entries: {
        Row: {
          amount: number
          btw_rate: number | null
          category: string
          created_at: string | null
          description: string | null
          direction: string
          document_id: string | null
          entry_date: string
          id: string
          // [CASH-SETTLE] the invoice this movement settles (cash_settlement_invoice_link.sql)
          invoice_id: string | null
          // [CASH-INSTALMENT] the single instalment it is (cash_settlement_per_instalment.sql)
          settlement_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          btw_rate?: number | null
          category: string
          created_at?: string | null
          description?: string | null
          direction: string
          document_id?: string | null
          entry_date?: string
          id?: string
          invoice_id?: string | null
          settlement_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          btw_rate?: number | null
          category?: string
          created_at?: string | null
          description?: string | null
          direction?: string
          document_id?: string | null
          entry_date?: string
          id?: string
          invoice_id?: string | null
          settlement_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "cash_entries_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cash_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bank_statement_periods: {
        Row: {
          closing_balance: number | null
          created_at: string
          currency: string | null
          document_id: string
          iban: string | null
          opening_balance: number | null
          period_end: string | null
          period_start: string | null
          user_id: string
        }
        Insert: {
          closing_balance?: number | null
          created_at?: string
          currency?: string | null
          document_id: string
          iban?: string | null
          opening_balance?: number | null
          period_end?: string | null
          period_start?: string | null
          user_id: string
        }
        Update: {
          closing_balance?: number | null
          created_at?: string
          currency?: string | null
          document_id?: string
          iban?: string | null
          opening_balance?: number | null
          period_end?: string | null
          period_start?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bank_statement_periods_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: true
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_daily: {
        Row: {
          account_nr: string | null
          created_at: string | null
          document_id: string | null
          id: string
          kind: string
          ledger_date: string
          received: number
          source: string
          spent: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          account_nr?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          kind: string
          ledger_date: string
          received?: number
          source?: string
          spent?: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          account_nr?: string | null
          created_at?: string | null
          document_id?: string | null
          id?: string
          kind?: string
          ledger_date?: string
          received?: number
          source?: string
          spent?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ledger_daily_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_daily_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_by: string | null
          address: string | null
          btw_number: string | null
          city: string | null
          created_at: string | null
          email: string | null
          iban: string | null
          id: string
          kvk_number: string | null
          name: string
          notes: string | null
          postal_code: string | null
          user_id: string | null
        }
        Insert: {
          created_by?: string | null
          address?: string | null
          btw_number?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name: string
          notes?: string | null
          postal_code?: string | null
          user_id?: string | null
        }
        Update: {
          created_by?: string | null
          address?: string | null
          btw_number?: string | null
          city?: string | null
          created_at?: string | null
          email?: string | null
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name?: string
          notes?: string | null
          postal_code?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "clients_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_member_invites: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          owner_id: string
          role: string
          status: string
          token: string
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id?: string
          owner_id: string
          role?: string
          status?: string
          token?: string
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          owner_id?: string
          role?: string
          status?: string
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_member_invites_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      company_members: {
        Row: {
          created_at: string
          id: string
          member_id: string
          owner_id: string
          revoked_at: string | null
          role: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          owner_id: string
          revoked_at?: string | null
          role?: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          owner_id?: string
          revoked_at?: string | null
          role?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "company_members_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      deletion_requests: {
        Row: {
          created_at: string | null
          data_eligible_for_deletion_at: string | null
          deleted_at: string | null
          email_confirmed: boolean | null
          export_confirmed: boolean | null
          id: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          data_eligible_for_deletion_at?: string | null
          deleted_at?: string | null
          email_confirmed?: boolean | null
          export_confirmed?: boolean | null
          id?: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          data_eligible_for_deletion_at?: string | null
          deleted_at?: string | null
          email_confirmed?: boolean | null
          export_confirmed?: boolean | null
          id?: string
          user_id?: string | null
        }
        Relationships: []
      }
      documents: {
        Row: {
          ai_doc_type: string | null
          ai_processed: boolean | null
          ai_suggested_folder: string | null
          content_hash: string | null
          created_at: string
          doc_type: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          folder_id: string | null
          id: string
          invoice_id: string | null
          notes: string | null
          period: string | null
          search_vector: unknown
          shared: boolean
          source: string | null
          starred: boolean | null
          trashed: boolean | null
          trashed_at: string | null
          user_id: string
          year: number | null
        }
        Insert: {
          ai_doc_type?: string | null
          ai_processed?: boolean | null
          ai_suggested_folder?: string | null
          content_hash?: string | null
          created_at?: string
          doc_type?: string | null
          file_name: string
          file_size: number
          file_type: string
          file_url: string
          folder_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period?: string | null
          search_vector?: unknown
          shared?: boolean
          source?: string | null
          starred?: boolean | null
          trashed?: boolean | null
          trashed_at?: string | null
          user_id: string
          year?: number | null
        }
        Update: {
          ai_doc_type?: string | null
          ai_processed?: boolean | null
          ai_suggested_folder?: string | null
          content_hash?: string | null
          created_at?: string
          doc_type?: string | null
          file_name?: string
          file_size?: number
          file_type?: string
          file_url?: string
          folder_id?: string | null
          id?: string
          invoice_id?: string | null
          notes?: string | null
          period?: string | null
          search_vector?: unknown
          shared?: boolean
          source?: string | null
          starred?: boolean | null
          trashed?: boolean | null
          trashed_at?: string | null
          user_id?: string
          year?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      draft_queue: {
        Row: {
          accountant_id: string | null
          client_id: string
          created_at: string | null
          id: string
          items: Json
          updated_at: string | null
        }
        Insert: {
          accountant_id?: string | null
          client_id: string
          created_at?: string | null
          id?: string
          items?: Json
          updated_at?: string | null
        }
        Update: {
          accountant_id?: string | null
          client_id?: string
          created_at?: string | null
          id?: string
          items?: Json
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "draft_queue_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "draft_queue_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_sender_rules: {
        Row: {
          action: string
          created_at: string
          created_from_invoice_id: string | null
          id: string
          sender_email: string
          user_id: string
        }
        Insert: {
          action?: string
          created_at?: string
          created_from_invoice_id?: string | null
          id?: string
          sender_email: string
          user_id: string
        }
        Update: {
          action?: string
          created_at?: string
          created_from_invoice_id?: string | null
          id?: string
          sender_email?: string
          user_id?: string
        }
        Relationships: []
      }
      email_connections: {
        Row: {
          access_token_secret_id: string | null
          connected_at: string | null
          email: string | null
          id: string
          last_synced_email_at: string | null
          needs_reauth: boolean
          provider: string
          refresh_token_secret_id: string | null
          tokens_encrypted_at: string | null
          user_id: string | null
        }
        Insert: {
          access_token_secret_id?: string | null
          connected_at?: string | null
          email?: string | null
          id?: string
          last_synced_email_at?: string | null
          needs_reauth?: boolean
          provider: string
          refresh_token_secret_id?: string | null
          tokens_encrypted_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_token_secret_id?: string | null
          connected_at?: string | null
          email?: string | null
          id?: string
          last_synced_email_at?: string | null
          needs_reauth?: boolean
          provider?: string
          refresh_token_secret_id?: string | null
          tokens_encrypted_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "email_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_skipped_attachments: {
        Row: {
          created_at: string
          filename: string | null
          id: string
          reason: string
          source_message_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          filename?: string | null
          id?: string
          reason?: string
          source_message_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          filename?: string | null
          id?: string
          reason?: string
          source_message_id?: string
          user_id?: string
        }
        Relationships: []
      }
      email_failed_attempts: {
        Row: {
          attempt_count: number
          created_at: string
          id: string
          last_error: string | null
          source_message_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          source_message_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          created_at?: string
          id?: string
          last_error?: string | null
          source_message_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      feedback: {
        Row: {
          created_at: string
          id: string
          image_path: string | null
          message: string
          page_path: string | null
          status: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          image_path?: string | null
          message: string
          page_path?: string | null
          status?: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          image_path?: string | null
          message?: string
          page_path?: string | null
          status?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "feedback_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          color: string | null
          created_at: string | null
          folder_type: string | null
          id: string
          is_system: boolean | null
          name: string
          parent_id: string | null
          starred: boolean | null
          user_id: string | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          folder_type?: string | null
          id?: string
          is_system?: boolean | null
          name: string
          parent_id?: string | null
          starred?: boolean | null
          user_id?: string | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          folder_type?: string | null
          id?: string
          is_system?: boolean | null
          name?: string
          parent_id?: string | null
          starred?: boolean | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "folders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          accountant_email: string
          created_at: string | null
          id: string
          invited_by: string | null
          status: string | null
          token: string | null
          zzper_id: string | null
        }
        Insert: {
          accountant_email: string
          created_at?: string | null
          id?: string
          invited_by?: string | null
          status?: string | null
          token?: string | null
          zzper_id?: string | null
        }
        Update: {
          accountant_email?: string
          created_at?: string | null
          id?: string
          invited_by?: string | null
          status?: string | null
          token?: string | null
          zzper_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_zzper_id_fkey"
            columns: ["zzper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_counters: {
        Row: {
          last_seq: number
          type: string
          user_id: string
          year: number
        }
        Insert: {
          last_seq?: number
          type: string
          user_id: string
          year: number
        }
        Update: {
          last_seq?: number
          type?: string
          user_id?: string
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "invoice_counters_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_lines: {
        Row: {
          btw_rate: number | null
          description: string | null
          discount_type: string | null
          discount_value: number | null
          id: string
          invoice_id: string | null
          line_total: number | null
          quantity: number | null
          unit: string | null
          unit_price: number | null
          vat_treatment: string | null
        }
        Insert: {
          btw_rate?: number | null
          description?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          invoice_id?: string | null
          line_total?: number | null
          quantity?: number | null
          unit?: string | null
          unit_price?: number | null
          vat_treatment?: string | null
        }
        Update: {
          btw_rate?: number | null
          description?: string | null
          discount_type?: string | null
          discount_value?: number | null
          id?: string
          invoice_id?: string | null
          line_total?: number | null
          quantity?: number | null
          unit?: string | null
          unit_price?: number | null
          vat_treatment?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoice_lines_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          confirmed_by: string | null
          created_by: string | null
          accountant_note: string | null
          accountant_status: string | null
          amount_paid: number
          archive_reason: string | null
          archived_at: string | null
          attachment_document_id: string | null
          btw_amount: number | null
          client_address: string | null
          client_btw_number: string | null
          client_city: string | null
          client_email: string | null
          client_extra_line1: string | null
          client_extra_line2: string | null
          client_extra_line3: string | null
          client_extra_line4: string | null
          client_id: string | null
          client_name: string | null
          client_postal_code: string | null
          created_at: string | null
          delivery_date: string | null
          discount_type: string | null
          discount_value: number | null
          direction: string | null
          document_id: string | null
          due_date: string | null
          field_confidence: Json | null
          id: string
          invoice_date: string | null
          invoice_number: string | null
          invoice_type: string | null
          marked_paid_at: string | null
          offerte_converted_to: string | null
          offerte_token: string | null
          offerte_response: string | null
          offerte_responded_at: string | null
          offerte_response_name: string | null
          original_invoice_id: string | null
          payment_date: string | null
          payment_method: string | null
          payment_prepared_at: string | null
          pay_token: string | null
          payment_reference: string | null
          pdf_url: string | null
          receiver_id: string | null
          reminders_paused: boolean
          replaced_by_number: string | null
          /** [SUPERSEDE] invoice_superseded_by.sql — the invoice number that replaced this one. Only set while archived; the restore routes clear it. A label: no financial query reads it. */
          superseded_by_number: string | null
          search_vector: unknown
          sender_id: string | null
          shared: boolean | null
          source: string | null
          source_message_id: string | null
          status: string | null
          supplier_id: string | null
          total_ex_btw: number | null
          total_inc_btw: number | null
          updated_at: string | null
          vat_deduction: string | null
          tax_kind: string | null
          vendor_iban: string | null
        }
        Insert: {
          confirmed_by?: string | null
          created_by?: string | null
          accountant_note?: string | null
          accountant_status?: string | null
          amount_paid?: number
          archive_reason?: string | null
          archived_at?: string | null
          attachment_document_id?: string | null
          btw_amount?: number | null
          client_address?: string | null
          client_btw_number?: string | null
          client_city?: string | null
          client_email?: string | null
          client_extra_line1?: string | null
          client_extra_line2?: string | null
          client_extra_line3?: string | null
          client_extra_line4?: string | null
          client_id?: string | null
          client_name?: string | null
          client_postal_code?: string | null
          created_at?: string | null
          delivery_date?: string | null
          discount_type?: string | null
          discount_value?: number | null
          direction?: string | null
          document_id?: string | null
          due_date?: string | null
          field_confidence?: Json | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          marked_paid_at?: string | null
          offerte_converted_to?: string | null
          offerte_token?: string | null
          offerte_response?: string | null
          offerte_responded_at?: string | null
          offerte_response_name?: string | null
          original_invoice_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_prepared_at?: string | null
          pay_token?: string | null
          payment_reference?: string | null
          pdf_url?: string | null
          receiver_id?: string | null
          reminders_paused?: boolean
          replaced_by_number?: string | null
          superseded_by_number?: string | null
          search_vector?: unknown
          sender_id?: string | null
          shared?: boolean | null
          source?: string | null
          source_message_id?: string | null
          status?: string | null
          supplier_id?: string | null
          total_ex_btw?: number | null
          total_inc_btw?: number | null
          updated_at?: string | null
          vat_deduction?: string | null
          tax_kind?: string | null
          vendor_iban?: string | null
        }
        Update: {
          confirmed_by?: string | null
          created_by?: string | null
          accountant_note?: string | null
          accountant_status?: string | null
          amount_paid?: number
          archive_reason?: string | null
          archived_at?: string | null
          attachment_document_id?: string | null
          btw_amount?: number | null
          client_address?: string | null
          client_btw_number?: string | null
          client_city?: string | null
          client_email?: string | null
          client_extra_line1?: string | null
          client_extra_line2?: string | null
          client_extra_line3?: string | null
          client_extra_line4?: string | null
          client_id?: string | null
          client_name?: string | null
          client_postal_code?: string | null
          created_at?: string | null
          delivery_date?: string | null
          discount_type?: string | null
          discount_value?: number | null
          direction?: string | null
          document_id?: string | null
          due_date?: string | null
          field_confidence?: Json | null
          id?: string
          invoice_date?: string | null
          invoice_number?: string | null
          invoice_type?: string | null
          marked_paid_at?: string | null
          offerte_converted_to?: string | null
          offerte_token?: string | null
          offerte_response?: string | null
          offerte_responded_at?: string | null
          offerte_response_name?: string | null
          original_invoice_id?: string | null
          payment_date?: string | null
          payment_method?: string | null
          payment_prepared_at?: string | null
          pay_token?: string | null
          payment_reference?: string | null
          pdf_url?: string | null
          receiver_id?: string | null
          reminders_paused?: boolean
          replaced_by_number?: string | null
          superseded_by_number?: string | null
          search_vector?: unknown
          sender_id?: string | null
          shared?: boolean | null
          source?: string | null
          source_message_id?: string | null
          status?: string | null
          supplier_id?: string | null
          total_ex_btw?: number | null
          total_inc_btw?: number | null
          updated_at?: string | null
          vat_deduction?: string | null
          tax_kind?: string | null
          vendor_iban?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invoices_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_offerte_converted_to_fkey"
            columns: ["offerte_converted_to"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_original_invoice_id_fkey"
            columns: ["original_invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_reminders: {
        Row: {
          day_offset: number
          email_to: string | null
          id: string
          invoice_id: string
          sent_at: string
          status: string
          user_id: string
        }
        Insert: {
          day_offset: number
          email_to?: string | null
          id?: string
          invoice_id: string
          sent_at?: string
          status?: string
          user_id: string
        }
        Update: {
          day_offset?: number
          email_to?: string | null
          id?: string
          invoice_id?: string
          sent_at?: string
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_reminders_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_reminders_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          read: boolean | null
          receiver_id: string
          sender_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          receiver_id: string
          sender_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          read?: boolean | null
          receiver_id?: string
          sender_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_receiver_id_fkey"
            columns: ["receiver_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string | null
          id: string
          link: string | null
          read: boolean | null
          title: string
          type: string | null
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          id?: string
          link?: string | null
          read?: boolean | null
          title: string
          type?: string | null
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          id?: string
          link?: string | null
          read?: boolean | null
          title?: string
          type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_bundle_invoices: {
        Row: {
          bundle_id: string
          created_at: string | null
          id: string
          invoice_id: string
          user_id: string
        }
        Insert: {
          bundle_id: string
          created_at?: string | null
          id?: string
          invoice_id: string
          user_id: string
        }
        Update: {
          bundle_id?: string
          created_at?: string | null
          id?: string
          invoice_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_bundle_invoices_bundle_id_fkey"
            columns: ["bundle_id"]
            isOneToOne: false
            referencedRelation: "pay_bundles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_bundle_invoices_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pay_bundle_invoices_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pay_bundles: {
        Row: {
          created_at: string | null
          id: string
          token: string
          user_id: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          token?: string
          user_id: string
        }
        Update: {
          created_at?: string | null
          id?: string
          token?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pay_bundles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          address: string | null
          account_purpose: string
          btw_number: string | null
          city: string | null
          company_name: string | null
          created_at: string | null
          email: string | null
          full_name: string | null
          iban: string | null
          id: string
          invoice_number_padding: number
          kas_opening_balance: number
          kor_active: boolean
          vat_exempt_activity: boolean
          vat_statement_note: string | null
          vat_exempt_since: string | null
          vat_scheme: string
          vat_scheme_since: string | null
          invoice_number_template: string | null
          kvk_number: string | null
          onboarding_done: boolean
          onboarding_step: number
          phone: string | null
          postal_code: string | null
          preferred_language: string | null
          referral_accountant_id: string | null
          reminder_offsets: number[]
          reminders_enabled: boolean
          reminders_enabled_at: string | null
          role: string | null
          subscription_plan: string | null
          subscription_stripe_id: string | null
          vak: string | null
        }
        Insert: {
          address?: string | null
          account_purpose?: string
          btw_number?: string | null
          city?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          iban?: string | null
          id: string
          invoice_number_padding?: number
          kas_opening_balance?: number
          kor_active?: boolean
          vat_exempt_activity?: boolean
          vat_statement_note?: string | null
          vat_exempt_since?: string | null
          vat_scheme?: string
          vat_scheme_since?: string | null
          invoice_number_template?: string | null
          kvk_number?: string | null
          onboarding_done?: boolean
          onboarding_step?: number
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string | null
          referral_accountant_id?: string | null
          reminder_offsets?: number[]
          reminders_enabled?: boolean
          reminders_enabled_at?: string | null
          role?: string | null
          subscription_plan?: string | null
          subscription_stripe_id?: string | null
          vak?: string | null
        }
        Update: {
          address?: string | null
          account_purpose?: string
          btw_number?: string | null
          city?: string | null
          company_name?: string | null
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          iban?: string | null
          id?: string
          invoice_number_padding?: number
          kas_opening_balance?: number
          kor_active?: boolean
          vat_exempt_activity?: boolean
          vat_statement_note?: string | null
          vat_exempt_since?: string | null
          vat_scheme?: string
          vat_scheme_since?: string | null
          invoice_number_template?: string | null
          kvk_number?: string | null
          onboarding_done?: boolean
          onboarding_step?: number
          phone?: string | null
          postal_code?: string | null
          preferred_language?: string | null
          referral_accountant_id?: string | null
          reminder_offsets?: number[]
          reminders_enabled?: boolean
          reminders_enabled_at?: string | null
          role?: string | null
          subscription_plan?: string | null
          subscription_stripe_id?: string | null
          vak?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "profiles_referral_accountant_id_fkey"
            columns: ["referral_accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rate_limits: {
        Row: {
          count: number
          endpoint: string
          id: string
          user_id: string
          window_start: string
        }
        Insert: {
          count?: number
          endpoint: string
          id?: string
          user_id: string
          window_start?: string
        }
        Update: {
          count?: number
          endpoint?: string
          id?: string
          user_id?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "rate_limits_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      referrals: {
        Row: {
          accountant_id: string | null
          active: boolean | null
          client_id: string | null
          created_at: string | null
          id: string
        }
        Insert: {
          accountant_id?: string | null
          active?: boolean | null
          client_id?: string | null
          created_at?: string | null
          id?: string
        }
        Update: {
          accountant_id?: string | null
          active?: boolean | null
          client_id?: string | null
          created_at?: string | null
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "referrals_accountant_id_fkey"
            columns: ["accountant_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "referrals_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      snelstart_connections: {
        Row: {
          administration_label: string | null
          client_key_secret_id: string | null
          connected_at: string
          id: string
          inkoop_grootboek_id: string | null
          key_stored_at: string | null
          last_error: string | null
          last_push_at: string | null
          status: string
          updated_at: string
          user_id: string
          verkoop_grootboek_id: string | null
        }
        Insert: {
          administration_label?: string | null
          client_key_secret_id?: string | null
          connected_at?: string
          id?: string
          inkoop_grootboek_id?: string | null
          key_stored_at?: string | null
          last_error?: string | null
          last_push_at?: string | null
          status?: string
          updated_at?: string
          user_id: string
          verkoop_grootboek_id?: string | null
        }
        Update: {
          administration_label?: string | null
          client_key_secret_id?: string | null
          connected_at?: string
          id?: string
          inkoop_grootboek_id?: string | null
          key_stored_at?: string | null
          last_error?: string | null
          last_push_at?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          verkoop_grootboek_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "snelstart_connections_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      snelstart_exports: {
        Row: {
          amount: number | null
          boeking_type: string
          direction: string
          error_code: string | null
          error_message: string | null
          id: string
          invoice_id: string
          pushed_at: string
          snelstart_id: string | null
          snelstart_relatie_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          boeking_type: string
          direction: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          invoice_id: string
          pushed_at?: string
          snelstart_id?: string | null
          snelstart_relatie_id?: string | null
          status: string
          user_id: string
        }
        Update: {
          amount?: number | null
          boeking_type?: string
          direction?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          invoice_id?: string
          pushed_at?: string
          snelstart_id?: string | null
          snelstart_relatie_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "snelstart_exports_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "snelstart_exports_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      // [UREN] supabase/migrations/urenregistratie.sql — hand-added for the reason this file's
      // header gives: the generator needs credentials this environment does not have, and typing
      // the table by hand is what makes the COMPILER check `invoice_id` instead of letting a typo
      // reach the one column that decides whether an hour gets billed twice.
      time_entries: {
        Row: {
          id: string
          user_id: string
          client_id: string | null
          worked_on: string
          description: string
          hours: number
          hourly_rate: number | null
          invoice_id: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          user_id: string
          client_id?: string | null
          worked_on: string
          description: string
          hours: number
          hourly_rate?: number | null
          invoice_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          user_id?: string
          client_id?: string | null
          worked_on?: string
          description?: string
          hours?: number
          hourly_rate?: number | null
          invoice_id?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "time_entries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "time_entries_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_aliases: {
        Row: {
          alias_key: string
          created_at: string
          id: string
          printed_name: string | null
          supplier_id: string
          user_id: string
        }
        Insert: {
          alias_key: string
          created_at?: string
          id?: string
          printed_name?: string | null
          supplier_id: string
          user_id: string
        }
        Update: {
          alias_key?: string
          created_at?: string
          id?: string
          printed_name?: string | null
          supplier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_aliases_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_aliases_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      supplier_iban_history: {
        Row: {
          actor_id: string | null
          iban: string
          id: string
          replaced_at: string
          replaced_by: string | null
          supplier_id: string
          user_id: string
        }
        Insert: {
          actor_id?: string | null
          iban: string
          id?: string
          replaced_at?: string
          replaced_by?: string | null
          supplier_id: string
          user_id: string
        }
        Update: {
          actor_id?: string | null
          iban?: string
          id?: string
          replaced_at?: string
          replaced_by?: string | null
          supplier_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "supplier_iban_history_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "supplier_iban_history_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          btw_number: string | null
          created_at: string
          iban: string | null
          id: string
          kvk_number: string | null
          name: string
          name_key: string | null
          updated_at: string
          user_id: string
          auto_incasso: boolean
          auto_incasso_since: string | null
          incasso_suggested_at: string | null
          default_btw_rate: number | null
          default_category: string | null
        }
        Insert: {
          btw_number?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name: string
          name_key?: string | null
          updated_at?: string
          user_id: string
          auto_incasso?: boolean
          auto_incasso_since?: string | null
          incasso_suggested_at?: string | null
          default_btw_rate?: number | null
          default_category?: string | null
        }
        Update: {
          btw_number?: string | null
          created_at?: string
          iban?: string | null
          id?: string
          kvk_number?: string | null
          name?: string
          name_key?: string | null
          updated_at?: string
          user_id?: string
          auto_incasso?: boolean
          auto_incasso_since?: string | null
          incasso_suggested_at?: string | null
          default_btw_rate?: number | null
          default_category?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "suppliers_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      /**
       * [BETAALPLAN] One line of a multi-invoice allocation — allocate_bank_payment.sql.
       *
       * Deliberately NOT apply_bank_payment: that one consumes the whole transaction on its first
       * call ("instalment semantics: one tx → one invoice"), so looping it booked the first invoice
       * of a batch and returned empty for every line after it. This one flips the line to 'matched'
       * only once it is spent to the cent, which is what lets a plan reach its second invoice.
       */
      allocate_bank_payment: {
        Args: {
          p_user_id: string
          p_tx_id: string
          p_invoice_id: string
          p_amount: number
          p_pay_date: string | null
        }
        Returns: {
          applied: number
          amount_paid: number
          total: number
          is_paid: boolean
          /** True once this call spent the line to the cent — the tx is now 'matched'. */
          line_done: boolean
          /** What the line still has left to give after this call. */
          line_remaining: number
        }[]
      }
      /**
       * [FACTUUR-B] Seed invoice_counters.last_seq forward-only — seed_invoice_counter.sql.
       *
       * GREATEST is evaluated inside the ON CONFLICT, against the row as it is at write time. The
       * route used to read last_seq, take Math.max in TypeScript and write the result with an
       * unconditional upsert, so a next_invoice_seq allocation inside that window made the counter
       * go BACKWARDS and the next invoice reused a sequence (Art. 35 Wet OB 1968).
       *
       * Returns the value that actually LANDED, which is what the owner is shown as their first
       * number — not the one they asked for.
       */
      seed_invoice_counter: {
        Args: {
          p_user_id: string
          p_year: number
          p_type: string
          p_last_seq: number
        }
        Returns: number
      }
      apply_bank_payment: {
        Args: {
          p_user_id: string
          p_tx_id: string
          p_invoice_id: string
          p_amount: number
          p_pay_date: string | null
        }
        Returns: {
          applied: number
          amount_paid: number
          total: number
          is_paid: boolean
        }[]
      }
      apply_manual_payment: {
        Args: {
          p_user_id: string
          p_invoice_id: string
          /** null = settle the whole remaining balance (the empty "Betaald bedrag" field) */
          p_amount: number | null
          p_pay_date: string
          p_method: string
          p_payable_statuses: string[]
          p_client_key: string | null
        }
        Returns: {
          applied: number
          amount_paid: number
          total: number
          is_paid: boolean
          /** true = this client_key was already booked; nothing was written */
          duplicate: boolean
        }[]
      }
      book_bank_batch: {
        Args: {
          p_user_id: string
          p_tx_id: string
          p_invoice_ids: string[]
          p_pay_date: string | null
        }
        Returns: {
          invoice_id: string
        }[]
      }
      check_rate_limit: {
        Args: {
          p_endpoint: string
          p_max_requests: number
          p_user_id: string
          p_window_minutes: number
        }
        Returns: {
          allowed: boolean
          remaining: number
          reset_at: string
        }[]
      }
      cleanup_old_rate_limits: { Args: never; Returns: number }
      get_accountant_for_zzper: {
        Args: { zzper_uuid: string }
        Returns: string
      }
      is_my_accountant_client: { Args: { client: string }; Returns: boolean }
      next_invoice_seq: {
        Args: { p_type: string; p_user_id: string; p_year: number }
        Returns: number
      }
      /**
       * [MOVE-PAYMENT] invoice_move_payment.sql — moves ONE booked payment
       * (a bank_tx_invoices row) to another invoice, atomically. Raises on every
       * refusal (55000), so an error means nothing changed.
       */
      move_invoice_payment: {
        Args: {
          p_user_id: string
          /** bank_tx_invoices.id — THE payment, not "the payments of" an invoice. */
          p_link_id: string
          p_target_invoice_id: string
        }
        Returns: {
          applied: number
          source_invoice_id: string
          source_amount_paid: number
          source_status: string
          target_amount_paid: number
          target_status: string
          target_is_paid: boolean
        }[]
      }
      /**
       * [PAYDATE-REDERIVE] Also re-derives payment_date/payment_method from the
       * earliest surviving link — the signature is unchanged.
       */
      recompute_invoice_amount_paid: {
        Args: { p_user_id: string; p_invoice_id: string }
        Returns: number
      }
      vault_delete_secret: { Args: { p_secret_id: string }; Returns: boolean }
      vault_read_secret: { Args: { p_secret_id: string }; Returns: string }
      vault_update_or_create_secret: {
        Args: { p_name: string; p_secret_id: string; p_value: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
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
  public: {
    Enums: {},
  },
} as const

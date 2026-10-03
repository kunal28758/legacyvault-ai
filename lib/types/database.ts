export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
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
      access_tokens: {
        Row: {
          beneficiary_id: string
          created_at: string
          dead_man_switch_id: string | null
          delivered_at: string | null
          delivery_provider_message_id: string | null
          emergency_request_id: string | null
          expires_at: string
          grant_type: Database["public"]["Enums"]["access_grant_type"]
          id: string
          last_used_at: string | null
          owner_user_id: string
          replaces_token_id: string | null
          revoked_at: string | null
          revoked_reason:
            | Database["public"]["Enums"]["token_revoked_reason"]
            | null
          scope: Json
          token_hash: string
          used_at: string | null
        }
        Insert: {
          beneficiary_id: string
          created_at?: string
          dead_man_switch_id?: string | null
          delivered_at?: string | null
          delivery_provider_message_id?: string | null
          emergency_request_id?: string | null
          expires_at: string
          grant_type: Database["public"]["Enums"]["access_grant_type"]
          id?: string
          last_used_at?: string | null
          owner_user_id: string
          replaces_token_id?: string | null
          revoked_at?: string | null
          revoked_reason?:
            | Database["public"]["Enums"]["token_revoked_reason"]
            | null
          scope: Json
          token_hash: string
          used_at?: string | null
        }
        Update: {
          beneficiary_id?: string
          created_at?: string
          dead_man_switch_id?: string | null
          delivered_at?: string | null
          delivery_provider_message_id?: string | null
          emergency_request_id?: string | null
          expires_at?: string
          grant_type?: Database["public"]["Enums"]["access_grant_type"]
          id?: string
          last_used_at?: string | null
          owner_user_id?: string
          replaces_token_id?: string | null
          revoked_at?: string | null
          revoked_reason?:
            | Database["public"]["Enums"]["token_revoked_reason"]
            | null
          scope?: Json
          token_hash?: string
          used_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "access_tokens_beneficiary_id_fkey"
            columns: ["beneficiary_id"]
            isOneToOne: false
            referencedRelation: "beneficiaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_tokens_dead_man_switch_id_fkey"
            columns: ["dead_man_switch_id"]
            isOneToOne: false
            referencedRelation: "dead_man_switches"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_tokens_emergency_request_id_fkey"
            columns: ["emergency_request_id"]
            isOneToOne: false
            referencedRelation: "emergency_access_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_tokens_owner_user_id_fkey"
            columns: ["owner_user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "access_tokens_replaces_token_id_fkey"
            columns: ["replaces_token_id"]
            isOneToOne: false
            referencedRelation: "access_tokens"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_draft_versions: {
        Row: {
          content: Json
          created_at: string
          created_by: Database["public"]["Enums"]["ai_version_author"]
          draft_id: string
          id: string
          interaction_id: string | null
          model: string | null
          prompt_version: string | null
          provider: string | null
          section_confidence: Json | null
          version_number: number
        }
        Insert: {
          content: Json
          created_at?: string
          created_by: Database["public"]["Enums"]["ai_version_author"]
          draft_id: string
          id?: string
          interaction_id?: string | null
          model?: string | null
          prompt_version?: string | null
          provider?: string | null
          section_confidence?: Json | null
          version_number: number
        }
        Update: {
          content?: Json
          created_at?: string
          created_by?: Database["public"]["Enums"]["ai_version_author"]
          draft_id?: string
          id?: string
          interaction_id?: string | null
          model?: string | null
          prompt_version?: string | null
          provider?: string | null
          section_confidence?: Json | null
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "ai_draft_versions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ai_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_draft_versions_interaction_id_fkey"
            columns: ["interaction_id"]
            isOneToOne: false
            referencedRelation: "ai_interactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_drafts: {
        Row: {
          confirmed_at: string | null
          confirmed_version_id: string | null
          created_at: string
          current_version_id: string | null
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["ai_draft_kind"]
          legacy_plan_id: string | null
          overall_confidence: number | null
          source_document_id: string | null
          status: Database["public"]["Enums"]["ai_draft_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          confirmed_at?: string | null
          confirmed_version_id?: string | null
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["ai_draft_kind"]
          legacy_plan_id?: string | null
          overall_confidence?: number | null
          source_document_id?: string | null
          status?: Database["public"]["Enums"]["ai_draft_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          confirmed_at?: string | null
          confirmed_version_id?: string | null
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["ai_draft_kind"]
          legacy_plan_id?: string | null
          overall_confidence?: number | null
          source_document_id?: string | null
          status?: Database["public"]["Enums"]["ai_draft_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_drafts_confirmed_version_fk"
            columns: ["confirmed_version_id"]
            isOneToOne: false
            referencedRelation: "ai_draft_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "ai_draft_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_legacy_plan_id_fkey"
            columns: ["legacy_plan_id"]
            isOneToOne: false
            referencedRelation: "legacy_plans"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_drafts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_interactions: {
        Row: {
          cost_estimate: number | null
          created_at: string
          draft_id: string | null
          id: string
          input_summary: string | null
          model: string | null
          output_summary: string | null
          prompt_version: string | null
          provider: string
          session_type: Database["public"]["Enums"]["ai_session_type"]
          token_count: number | null
          user_id: string
          validation: Json | null
        }
        Insert: {
          cost_estimate?: number | null
          created_at?: string
          draft_id?: string | null
          id?: string
          input_summary?: string | null
          model?: string | null
          output_summary?: string | null
          prompt_version?: string | null
          provider: string
          session_type: Database["public"]["Enums"]["ai_session_type"]
          token_count?: number | null
          user_id: string
          validation?: Json | null
        }
        Update: {
          cost_estimate?: number | null
          created_at?: string
          draft_id?: string | null
          id?: string
          input_summary?: string | null
          model?: string | null
          output_summary?: string | null
          prompt_version?: string | null
          provider?: string
          session_type?: Database["public"]["Enums"]["ai_session_type"]
          token_count?: number | null
          user_id?: string
          validation?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_interactions_draft_id_fkey"
            columns: ["draft_id"]
            isOneToOne: false
            referencedRelation: "ai_drafts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ai_interactions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_role: string | null
          correlation_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          outcome: Database["public"]["Enums"]["audit_outcome"]
          resource_id: string | null
          resource_type: string
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_role?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          outcome: Database["public"]["Enums"]["audit_outcome"]
          resource_id?: string | null
          resource_type: string
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_role?: string | null
          correlation_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          outcome?: Database["public"]["Enums"]["audit_outcome"]
          resource_id?: string | null
          resource_type?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      beneficiaries: {
        Row: {
          activated_at: string | null
          created_at: string
          deleted_at: string | null
          email: string
          id: string
          invited_at: string | null
          name: string
          notes: string | null
          phone: string | null
          relationship: string
          status: Database["public"]["Enums"]["beneficiary_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          activated_at?: string | null
          created_at?: string
          deleted_at?: string | null
          email: string
          id?: string
          invited_at?: string | null
          name: string
          notes?: string | null
          phone?: string | null
          relationship: string
          status?: Database["public"]["Enums"]["beneficiary_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          activated_at?: string | null
          created_at?: string
          deleted_at?: string | null
          email?: string
          id?: string
          invited_at?: string | null
          name?: string
          notes?: string | null
          phone?: string | null
          relationship?: string
          status?: Database["public"]["Enums"]["beneficiary_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beneficiaries_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      beneficiary_assignments: {
        Row: {
          allocation_percentage: number | null
          beneficiary_id: string
          created_at: string
          id: string
          resource_id: string
          resource_type: Database["public"]["Enums"]["assignment_resource_type"]
          updated_at: string
          user_id: string
        }
        Insert: {
          allocation_percentage?: number | null
          beneficiary_id: string
          created_at?: string
          id?: string
          resource_id: string
          resource_type: Database["public"]["Enums"]["assignment_resource_type"]
          updated_at?: string
          user_id: string
        }
        Update: {
          allocation_percentage?: number | null
          beneficiary_id?: string
          created_at?: string
          id?: string
          resource_id?: string
          resource_type?: Database["public"]["Enums"]["assignment_resource_type"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "beneficiary_assignments_beneficiary_id_fkey"
            columns: ["beneficiary_id"]
            isOneToOne: false
            referencedRelation: "beneficiaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "beneficiary_assignments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_man_switch_contacts: {
        Row: {
          beneficiary_id: string
          created_at: string
          dead_man_switch_id: string
          notify_order: number
        }
        Insert: {
          beneficiary_id: string
          created_at?: string
          dead_man_switch_id: string
          notify_order?: number
        }
        Update: {
          beneficiary_id?: string
          created_at?: string
          dead_man_switch_id?: string
          notify_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "dead_man_switch_contacts_beneficiary_id_fkey"
            columns: ["beneficiary_id"]
            isOneToOne: false
            referencedRelation: "beneficiaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dead_man_switch_contacts_dead_man_switch_id_fkey"
            columns: ["dead_man_switch_id"]
            isOneToOne: false
            referencedRelation: "dead_man_switches"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_man_switch_events: {
        Row: {
          created_at: string
          dead_man_switch_id: string
          event_type: Database["public"]["Enums"]["dms_event_type"]
          id: string
          metadata: Json | null
          new_state: string
          previous_state: string
        }
        Insert: {
          created_at?: string
          dead_man_switch_id: string
          event_type: Database["public"]["Enums"]["dms_event_type"]
          id?: string
          metadata?: Json | null
          new_state: string
          previous_state: string
        }
        Update: {
          created_at?: string
          dead_man_switch_id?: string
          event_type?: Database["public"]["Enums"]["dms_event_type"]
          id?: string
          metadata?: Json | null
          new_state?: string
          previous_state?: string
        }
        Relationships: [
          {
            foreignKeyName: "dead_man_switch_events_dead_man_switch_id_fkey"
            columns: ["dead_man_switch_id"]
            isOneToOne: false
            referencedRelation: "dead_man_switches"
            referencedColumns: ["id"]
          },
        ]
      }
      dead_man_switches: {
        Row: {
          check_in_frequency_days: number
          created_at: string
          current_escalation_step: number
          escalation_delay_hours: number
          escalation_rules: Json
          id: string
          inactivity_period_days: number
          last_check_in_at: string | null
          next_check_in_at: string | null
          paused_at: string | null
          release_scope: Json
          status: Database["public"]["Enums"]["dms_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          check_in_frequency_days: number
          created_at?: string
          current_escalation_step?: number
          escalation_delay_hours?: number
          escalation_rules?: Json
          id?: string
          inactivity_period_days: number
          last_check_in_at?: string | null
          next_check_in_at?: string | null
          paused_at?: string | null
          release_scope?: Json
          status?: Database["public"]["Enums"]["dms_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          check_in_frequency_days?: number
          created_at?: string
          current_escalation_step?: number
          escalation_delay_hours?: number
          escalation_rules?: Json
          id?: string
          inactivity_period_days?: number
          last_check_in_at?: string | null
          next_check_in_at?: string | null
          paused_at?: string | null
          release_scope?: Json
          status?: Database["public"]["Enums"]["dms_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "dead_man_switches_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: true
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      digital_assets: {
        Row: {
          category: Database["public"]["Enums"]["digital_asset_category"]
          created_at: string
          credentials: string | null
          currency: string
          deleted_at: string | null
          estimated_value: number | null
          id: string
          metadata: Json | null
          name: string
          notes: string | null
          platform: string | null
          recovery_info: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          category: Database["public"]["Enums"]["digital_asset_category"]
          created_at?: string
          credentials?: string | null
          currency?: string
          deleted_at?: string | null
          estimated_value?: number | null
          id?: string
          metadata?: Json | null
          name: string
          notes?: string | null
          platform?: string | null
          recovery_info?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          category?: Database["public"]["Enums"]["digital_asset_category"]
          created_at?: string
          credentials?: string | null
          currency?: string
          deleted_at?: string | null
          estimated_value?: number | null
          id?: string
          metadata?: Json | null
          name?: string
          notes?: string | null
          platform?: string | null
          recovery_info?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "digital_assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_attachments: {
        Row: {
          created_at: string
          document_id: string
          id: string
          resource_id: string
          resource_type: Database["public"]["Enums"]["attachment_resource_type"]
          user_id: string
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          resource_id: string
          resource_type: Database["public"]["Enums"]["attachment_resource_type"]
          user_id: string
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          resource_id?: string
          resource_type?: Database["public"]["Enums"]["attachment_resource_type"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "document_attachments_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_attachments_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      document_versions: {
        Row: {
          created_at: string
          document_id: string
          id: string
          size_bytes: number
          storage_key: string
          uploaded_by: string
          version_number: number
        }
        Insert: {
          created_at?: string
          document_id: string
          id?: string
          size_bytes: number
          storage_key: string
          uploaded_by: string
          version_number: number
        }
        Update: {
          created_at?: string
          document_id?: string
          id?: string
          size_bytes?: number
          storage_key?: string
          uploaded_by?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "document_versions_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      documents: {
        Row: {
          created_at: string
          current_version_id: string | null
          deleted_at: string | null
          encryption_key_id: string | null
          encryption_mode: Database["public"]["Enums"]["encryption_mode"]
          folder_id: string | null
          id: string
          metadata: Json | null
          mime_type: string
          name: string
          scan_status: Database["public"]["Enums"]["scan_status"]
          size_bytes: number
          storage_bucket: string
          storage_key: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          encryption_key_id?: string | null
          encryption_mode?: Database["public"]["Enums"]["encryption_mode"]
          folder_id?: string | null
          id?: string
          metadata?: Json | null
          mime_type: string
          name: string
          scan_status?: Database["public"]["Enums"]["scan_status"]
          size_bytes: number
          storage_bucket?: string
          storage_key: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          current_version_id?: string | null
          deleted_at?: string | null
          encryption_key_id?: string | null
          encryption_mode?: Database["public"]["Enums"]["encryption_mode"]
          folder_id?: string | null
          id?: string
          metadata?: Json | null
          mime_type?: string
          name?: string
          scan_status?: Database["public"]["Enums"]["scan_status"]
          size_bytes?: number
          storage_bucket?: string
          storage_key?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_current_version_fk"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "document_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "documents_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_access_configs: {
        Row: {
          access_duration_hours: number
          access_scope: Json
          beneficiary_id: string
          created_at: string
          deleted_at: string | null
          id: string
          last_designation_sent_at: string | null
          on_timeout: Database["public"]["Enums"]["ea_on_timeout"]
          request_expiry_hours: number
          status: Database["public"]["Enums"]["ea_config_status"]
          timeout_hours: number | null
          updated_at: string
          user_id: string
          verification_method: Database["public"]["Enums"]["ea_verification_method"]
        }
        Insert: {
          access_duration_hours?: number
          access_scope: Json
          beneficiary_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_designation_sent_at?: string | null
          on_timeout?: Database["public"]["Enums"]["ea_on_timeout"]
          request_expiry_hours?: number
          status?: Database["public"]["Enums"]["ea_config_status"]
          timeout_hours?: number | null
          updated_at?: string
          user_id: string
          verification_method?: Database["public"]["Enums"]["ea_verification_method"]
        }
        Update: {
          access_duration_hours?: number
          access_scope?: Json
          beneficiary_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          last_designation_sent_at?: string | null
          on_timeout?: Database["public"]["Enums"]["ea_on_timeout"]
          request_expiry_hours?: number
          status?: Database["public"]["Enums"]["ea_config_status"]
          timeout_hours?: number | null
          updated_at?: string
          user_id?: string
          verification_method?: Database["public"]["Enums"]["ea_verification_method"]
        }
        Relationships: [
          {
            foreignKeyName: "emergency_access_configs_beneficiary_id_fkey"
            columns: ["beneficiary_id"]
            isOneToOne: false
            referencedRelation: "beneficiaries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_access_configs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      emergency_access_requests: {
        Row: {
          access_token_id: string | null
          config_id: string
          created_at: string
          decided_at: string | null
          decided_by: Database["public"]["Enums"]["ea_decided_by"] | null
          expires_at: string | null
          granted_at: string | null
          id: string
          otp_expires_at: string | null
          otp_hash: string | null
          request_expires_at: string
          requester_email: string
          revoked_at: string | null
          revoked_by: Database["public"]["Enums"]["ea_revoked_by"] | null
          status: Database["public"]["Enums"]["ea_request_status"]
          updated_at: string
          verification_attempts: number
        }
        Insert: {
          access_token_id?: string | null
          config_id: string
          created_at?: string
          decided_at?: string | null
          decided_by?: Database["public"]["Enums"]["ea_decided_by"] | null
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          otp_expires_at?: string | null
          otp_hash?: string | null
          request_expires_at: string
          requester_email: string
          revoked_at?: string | null
          revoked_by?: Database["public"]["Enums"]["ea_revoked_by"] | null
          status?: Database["public"]["Enums"]["ea_request_status"]
          updated_at?: string
          verification_attempts?: number
        }
        Update: {
          access_token_id?: string | null
          config_id?: string
          created_at?: string
          decided_at?: string | null
          decided_by?: Database["public"]["Enums"]["ea_decided_by"] | null
          expires_at?: string | null
          granted_at?: string | null
          id?: string
          otp_expires_at?: string | null
          otp_hash?: string | null
          request_expires_at?: string
          requester_email?: string
          revoked_at?: string | null
          revoked_by?: Database["public"]["Enums"]["ea_revoked_by"] | null
          status?: Database["public"]["Enums"]["ea_request_status"]
          updated_at?: string
          verification_attempts?: number
        }
        Relationships: [
          {
            foreignKeyName: "ea_requests_access_token_fk"
            columns: ["access_token_id"]
            isOneToOne: false
            referencedRelation: "access_tokens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "emergency_access_requests_config_id_fkey"
            columns: ["config_id"]
            isOneToOne: false
            referencedRelation: "emergency_access_configs"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_assets: {
        Row: {
          account_number: string | null
          category: Database["public"]["Enums"]["financial_asset_category"]
          created_at: string
          currency: string
          deleted_at: string | null
          estimated_value: number | null
          id: string
          institution: string | null
          metadata: Json | null
          name: string
          notes: string | null
          policy_number: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_number?: string | null
          category: Database["public"]["Enums"]["financial_asset_category"]
          created_at?: string
          currency?: string
          deleted_at?: string | null
          estimated_value?: number | null
          id?: string
          institution?: string | null
          metadata?: Json | null
          name: string
          notes?: string | null
          policy_number?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_number?: string | null
          category?: Database["public"]["Enums"]["financial_asset_category"]
          created_at?: string
          currency?: string
          deleted_at?: string | null
          estimated_value?: number | null
          id?: string
          institution?: string | null
          metadata?: Json | null
          name?: string
          notes?: string | null
          policy_number?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "financial_assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      folders: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          parent_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          parent_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
          user_id?: string
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
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          idempotency_key: string | null
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          progress: Json | null
          run_at: string
          status: Database["public"]["Enums"]["job_status"]
          type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          progress?: Json | null
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          type: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          last_error?: string | null
          locked_at?: string | null
          locked_by?: string | null
          max_attempts?: number
          payload?: Json
          progress?: Json | null
          run_at?: string
          status?: Database["public"]["Enums"]["job_status"]
          type?: string
          updated_at?: string
        }
        Relationships: []
      }
      legacy_plan_versions: {
        Row: {
          acknowledged_incomplete: boolean
          completeness: Json
          created_at: string
          finalized_at: string
          id: string
          incomplete_sections: string[]
          legacy_plan_id: string
          snapshot_data: Json
          version_number: number
        }
        Insert: {
          acknowledged_incomplete?: boolean
          completeness: Json
          created_at?: string
          finalized_at: string
          id?: string
          incomplete_sections?: string[]
          legacy_plan_id: string
          snapshot_data: Json
          version_number: number
        }
        Update: {
          acknowledged_incomplete?: boolean
          completeness?: Json
          created_at?: string
          finalized_at?: string
          id?: string
          incomplete_sections?: string[]
          legacy_plan_id?: string
          snapshot_data?: Json
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "legacy_plan_versions_legacy_plan_id_fkey"
            columns: ["legacy_plan_id"]
            isOneToOne: false
            referencedRelation: "legacy_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      legacy_plans: {
        Row: {
          completion_status: Json
          confirmed_by: string | null
          created_at: string
          current_step: number
          deleted_at: string | null
          finalized_at: string | null
          id: string
          lock_version: number
          status: Database["public"]["Enums"]["legacy_plan_status"]
          steps_data: Json
          updated_at: string
          user_id: string
          version: number
        }
        Insert: {
          completion_status?: Json
          confirmed_by?: string | null
          created_at?: string
          current_step?: number
          deleted_at?: string | null
          finalized_at?: string | null
          id?: string
          lock_version?: number
          status?: Database["public"]["Enums"]["legacy_plan_status"]
          steps_data?: Json
          updated_at?: string
          user_id: string
          version?: number
        }
        Update: {
          completion_status?: Json
          confirmed_by?: string | null
          created_at?: string
          current_step?: number
          deleted_at?: string | null
          finalized_at?: string | null
          id?: string
          lock_version?: number
          status?: Database["public"]["Enums"]["legacy_plan_status"]
          steps_data?: Json
          updated_at?: string
          user_id?: string
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "legacy_plans_confirmed_by_fkey"
            columns: ["confirmed_by"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "legacy_plans_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          channel: Database["public"]["Enums"]["notification_channel"]
          content: string
          created_at: string
          delivery_status: Database["public"]["Enums"]["notification_delivery_status"]
          id: string
          last_retry_at: string | null
          metadata: Json | null
          provider_message_id: string | null
          read_at: string | null
          retry_count: number
          title: string
          type: string
          user_id: string
        }
        Insert: {
          channel: Database["public"]["Enums"]["notification_channel"]
          content: string
          created_at?: string
          delivery_status?: Database["public"]["Enums"]["notification_delivery_status"]
          id?: string
          last_retry_at?: string | null
          metadata?: Json | null
          provider_message_id?: string | null
          read_at?: string | null
          retry_count?: number
          title: string
          type: string
          user_id: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["notification_channel"]
          content?: string
          created_at?: string
          delivery_status?: Database["public"]["Enums"]["notification_delivery_status"]
          id?: string
          last_retry_at?: string | null
          metadata?: Json | null
          provider_message_id?: string | null
          read_at?: string | null
          retry_count?: number
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      physical_assets: {
        Row: {
          category: Database["public"]["Enums"]["physical_asset_category"]
          created_at: string
          currency: string
          deleted_at: string | null
          description: string | null
          estimated_value: number | null
          id: string
          location: string | null
          metadata: Json | null
          name: string
          notes: string | null
          ownership_details: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["physical_asset_category"]
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          location?: string | null
          metadata?: Json | null
          name: string
          notes?: string | null
          ownership_details?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["physical_asset_category"]
          created_at?: string
          currency?: string
          deleted_at?: string | null
          description?: string | null
          estimated_value?: number | null
          id?: string
          location?: string | null
          metadata?: Json | null
          name?: string
          notes?: string | null
          ownership_details?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "physical_assets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      processed_webhook_events: {
        Row: {
          event_id: string
          event_type: string
          processed_at: string | null
          provider: Database["public"]["Enums"]["webhook_provider"]
          received_at: string
        }
        Insert: {
          event_id: string
          event_type: string
          processed_at?: string | null
          provider: Database["public"]["Enums"]["webhook_provider"]
          received_at?: string
        }
        Update: {
          event_id?: string
          event_type?: string
          processed_at?: string | null
          provider?: Database["public"]["Enums"]["webhook_provider"]
          received_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          count: number
          key: string
          window_start: string
        }
        Insert: {
          count?: number
          key: string
          window_start: string
        }
        Update: {
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      upload_sessions: {
        Row: {
          created_at: string
          declared_mime_type: string
          declared_name: string
          declared_size_bytes: number
          expires_at: string
          folder_id: string | null
          id: string
          kind: Database["public"]["Enums"]["upload_kind"]
          rejection_reason: string | null
          status: Database["public"]["Enums"]["upload_status"]
          target_document_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          declared_mime_type: string
          declared_name: string
          declared_size_bytes: number
          expires_at?: string
          folder_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["upload_kind"]
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          target_document_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          declared_mime_type?: string
          declared_name?: string
          declared_size_bytes?: number
          expires_at?: string
          folder_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["upload_kind"]
          rejection_reason?: string | null
          status?: Database["public"]["Enums"]["upload_status"]
          target_document_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "upload_sessions_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_sessions_target_document_id_fkey"
            columns: ["target_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "upload_sessions_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          address: Json | null
          alternate_email: string | null
          clerk_user_id: string
          created_at: string
          date_of_birth: string | null
          deleted_at: string | null
          deletion_requested_at: string | null
          email: string
          email_verified: boolean
          family_info: Json | null
          id: string
          identification_details: string | null
          last_login_at: string | null
          mfa_enabled: boolean
          name: string
          notification_preferences: Json | null
          onboarding_completed_at: string | null
          phone: string | null
          preferences: Json | null
          role: Database["public"]["Enums"]["user_role"]
          security_preferences: Json | null
          updated_at: string
        }
        Insert: {
          address?: Json | null
          alternate_email?: string | null
          clerk_user_id: string
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          deletion_requested_at?: string | null
          email: string
          email_verified?: boolean
          family_info?: Json | null
          id?: string
          identification_details?: string | null
          last_login_at?: string | null
          mfa_enabled?: boolean
          name: string
          notification_preferences?: Json | null
          onboarding_completed_at?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
          security_preferences?: Json | null
          updated_at?: string
        }
        Update: {
          address?: Json | null
          alternate_email?: string | null
          clerk_user_id?: string
          created_at?: string
          date_of_birth?: string | null
          deleted_at?: string | null
          deletion_requested_at?: string | null
          email?: string
          email_verified?: boolean
          family_info?: Json | null
          id?: string
          identification_details?: string | null
          last_login_at?: string | null
          mfa_enabled?: boolean
          name?: string
          notification_preferences?: Json | null
          onboarding_completed_at?: string | null
          phone?: string | null
          preferences?: Json | null
          role?: Database["public"]["Enums"]["user_role"]
          security_preferences?: Json | null
          updated_at?: string
        }
        Relationships: []
      }
      video_messages: {
        Row: {
          created_at: string
          deleted_at: string | null
          delivery_condition: Database["public"]["Enums"]["delivery_condition"]
          description: string | null
          encryption_key_id: string | null
          encryption_mode: Database["public"]["Enums"]["encryption_mode"]
          id: string
          metadata: Json | null
          mime_type: string
          scan_status: Database["public"]["Enums"]["scan_status"]
          size_bytes: number
          storage_bucket: string
          storage_key: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          delivery_condition: Database["public"]["Enums"]["delivery_condition"]
          description?: string | null
          encryption_key_id?: string | null
          encryption_mode?: Database["public"]["Enums"]["encryption_mode"]
          id?: string
          metadata?: Json | null
          mime_type: string
          scan_status?: Database["public"]["Enums"]["scan_status"]
          size_bytes: number
          storage_bucket?: string
          storage_key: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          delivery_condition?: Database["public"]["Enums"]["delivery_condition"]
          description?: string | null
          encryption_key_id?: string | null
          encryption_mode?: Database["public"]["Enums"]["encryption_mode"]
          id?: string
          metadata?: Json | null
          mime_type?: string
          scan_status?: Database["public"]["Enums"]["scan_status"]
          size_bytes?: number
          storage_bucket?: string
          storage_key?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "video_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      assign_beneficiary: {
        Args: {
          p_allocation?: number
          p_beneficiary_id: string
          p_corr?: string
          p_resource_id: string
          p_resource_type: Database["public"]["Enums"]["assignment_resource_type"]
        }
        Returns: string
      }
      attach_document: {
        Args: {
          p_corr?: string
          p_document_id: string
          p_resource_id: string
          p_resource_type: Database["public"]["Enums"]["attachment_resource_type"]
        }
        Returns: string
      }
      claim_jobs: {
        Args: { p_limit?: number; p_runner_id?: string }
        Returns: {
          attempts: number
          created_at: string
          finished_at: string | null
          id: string
          idempotency_key: string | null
          last_error: string | null
          locked_at: string | null
          locked_by: string | null
          max_attempts: number
          payload: Json
          progress: Json | null
          run_at: string
          status: Database["public"]["Enums"]["job_status"]
          type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "jobs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      confirm_ai_draft: {
        Args: { p_corr?: string; p_draft_id: string; p_version_id: string }
        Returns: undefined
      }
      confirm_analysis_findings: {
        Args: {
          p_assets?: Json
          p_beneficiaries?: Json
          p_corr?: string
          p_draft_id: string
        }
        Returns: Json
      }
      create_asset: {
        Args: {
          p_corr?: string
          p_encrypted?: Json
          p_plain: Json
          p_resource_type: Database["public"]["Enums"]["assignment_resource_type"]
        }
        Returns: string
      }
      create_legacy_plan: { Args: { p_corr?: string }; Returns: string }
      create_plan_draft: {
        Args: { p_corr?: string; p_from_plan_id: string }
        Returns: string
      }
      current_jwt_role: { Args: never; Returns: string }
      current_user_id: { Args: never; Returns: string }
      delete_asset: {
        Args: {
          p_asset_id: string
          p_corr?: string
          p_resource_type: Database["public"]["Enums"]["assignment_resource_type"]
        }
        Returns: undefined
      }
      delete_document: {
        Args: { p_corr?: string; p_document_id: string }
        Returns: undefined
      }
      delete_video: {
        Args: { p_corr?: string; p_video_id: string }
        Returns: undefined
      }
      detach_document: {
        Args: { p_attachment_id: string; p_corr?: string }
        Returns: undefined
      }
      dms_cancel_escalation: { Args: { p_corr?: string }; Returns: undefined }
      dms_check_in: { Args: { p_corr?: string }; Returns: undefined }
      dms_configure: {
        Args: {
          p_config: Json
          p_contact_beneficiary_ids: string[]
          p_corr?: string
          p_release_scope: Json
        }
        Returns: string
      }
      dms_disable: { Args: { p_corr?: string }; Returns: undefined }
      dms_pause: { Args: { p_corr?: string }; Returns: undefined }
      dms_resume: { Args: { p_corr?: string }; Returns: undefined }
      dms_transition: {
        Args: {
          p_event_type: Database["public"]["Enums"]["dms_event_type"]
          p_from: Database["public"]["Enums"]["dms_status"]
          p_metadata?: Json
          p_switch_id: string
          p_to: Database["public"]["Enums"]["dms_status"]
        }
        Returns: string
      }
      ea_configure_contact: {
        Args: {
          p_access_duration_hours?: number
          p_access_scope: Json
          p_beneficiary_id: string
          p_corr?: string
          p_on_timeout?: Database["public"]["Enums"]["ea_on_timeout"]
          p_request_expiry_hours?: number
          p_timeout_hours?: number
        }
        Returns: string
      }
      ea_decide_request: {
        Args: { p_corr?: string; p_decision: string; p_request_id: string }
        Returns: undefined
      }
      ea_remove_contact: {
        Args: { p_config_id: string; p_corr?: string }
        Returns: undefined
      }
      ea_request_access: {
        Args: {
          p_config_id: string
          p_otp_hash: string
          p_requester_email: string
        }
        Returns: string
      }
      ea_revoke: {
        Args: { p_corr?: string; p_request_id: string }
        Returns: undefined
      }
      ea_transition: {
        Args: {
          p_metadata?: Json
          p_request_id: string
          p_to: Database["public"]["Enums"]["ea_request_status"]
        }
        Returns: Database["public"]["Enums"]["ea_request_status"]
      }
      ea_update_contact: {
        Args: {
          p_access_duration_hours?: number
          p_access_scope?: Json
          p_config_id: string
          p_corr?: string
          p_on_timeout?: Database["public"]["Enums"]["ea_on_timeout"]
          p_request_expiry_hours?: number
          p_timeout_hours?: number
        }
        Returns: undefined
      }
      ea_verify_otp: {
        Args: { p_otp_hash: string; p_request_id: string }
        Returns: Database["public"]["Enums"]["ea_request_status"]
      }
      finalize_legacy_plan: {
        Args: {
          p_acknowledge_incomplete?: boolean
          p_corr?: string
          p_expected_lock_version: number
          p_plan_id: string
        }
        Returns: string
      }
      issue_access_token: {
        Args: {
          p_beneficiary_id: string
          p_corr?: string
          p_expires_at: string
          p_scope: Json
          p_token_hash: string
        }
        Returns: string
      }
      lv_audit: {
        Args: {
          p_action: string
          p_actor: string
          p_corr: string
          p_metadata: Json
          p_outcome: Database["public"]["Enums"]["audit_outcome"]
          p_resource_id: string
          p_resource_type: string
        }
        Returns: string
      }
      lv_dms_event: {
        Args: {
          p_meta: Json
          p_new: string
          p_prev: string
          p_switch: string
          p_type: Database["public"]["Enums"]["dms_event_type"]
        }
        Returns: string
      }
      lv_end: { Args: never; Returns: undefined }
      lv_enqueue_access_delivery: {
        Args: {
          p_beneficiary: string
          p_grant: Database["public"]["Enums"]["access_grant_type"]
          p_payload: Json
          p_resend: boolean
          p_source: string
        }
        Returns: string
      }
      lv_enqueue_job: {
        Args: {
          p_key: string
          p_payload: Json
          p_run_at?: string
          p_type: string
        }
        Returns: string
      }
      lv_envelope_text: {
        Args: { p_field: string; p_value: Json }
        Returns: string
      }
      lv_forbidden: { Args: never; Returns: undefined }
      lv_is_envelope: { Args: { p_value: Json }; Returns: boolean }
      lv_jsonb_uuid_array: {
        Args: { p_field: string; p_value: Json }
        Returns: string[]
      }
      lv_raise_409: {
        Args: { p_code: string; p_detail?: Json }
        Returns: undefined
      }
      lv_raise_422: {
        Args: { p_code: string; p_detail?: Json }
        Returns: undefined
      }
      lv_require_user: { Args: never; Returns: string }
      lv_resource_owned: {
        Args: { p_id: string; p_owner: string; p_type: string }
        Returns: boolean
      }
      lv_revoke_token: {
        Args: {
          p_reason: Database["public"]["Enums"]["token_revoked_reason"]
          p_token_id: string
        }
        Returns: boolean
      }
      lv_revoke_tokens_for_beneficiary: {
        Args: {
          p_beneficiary: string
          p_reason: Database["public"]["Enums"]["token_revoked_reason"]
        }
        Returns: number
      }
      lv_scope_subset: {
        Args: { p_allowed: Json; p_scope: Json }
        Returns: boolean
      }
      lv_validate_scope: {
        Args: {
          p_beneficiary: string
          p_grant: Database["public"]["Enums"]["access_grant_type"]
          p_owner: string
          p_scope: Json
        }
        Returns: Json
      }
      lv_video_allowed: {
        Args: {
          p_condition: Database["public"]["Enums"]["delivery_condition"]
          p_grant: Database["public"]["Enums"]["access_grant_type"]
        }
        Returns: boolean
      }
      promote_upload: {
        Args: { p_metadata?: Json; p_target: Json; p_upload_id: string }
        Returns: string
      }
      rate_limit_hit: {
        Args: { p_key: string; p_limit: number; p_window_start: string }
        Returns: Json
      }
      record_webhook_event: {
        Args: {
          p_event_id: string
          p_event_type: string
          p_provider: Database["public"]["Enums"]["webhook_provider"]
        }
        Returns: boolean
      }
      remove_beneficiary: {
        Args: { p_beneficiary_id: string; p_corr?: string }
        Returns: undefined
      }
      resend_access_token: {
        Args: {
          p_corr?: string
          p_expires_at: string
          p_token_hash: string
          p_token_id: string
        }
        Returns: string
      }
      revoke_access_token: {
        Args: { p_corr?: string; p_token_id: string }
        Returns: undefined
      }
      save_plan_step: {
        Args: {
          p_corr?: string
          p_data: Json
          p_expected_lock_version: number
          p_plan_id: string
          p_step: string
        }
        Returns: Json
      }
      set_beneficiary_status: {
        Args: {
          p_beneficiary_id: string
          p_corr?: string
          p_status: Database["public"]["Enums"]["beneficiary_status"]
        }
        Returns: undefined
      }
      set_encrypted_fields: {
        Args: {
          p_corr?: string
          p_fields: Json
          p_resource_id: string
          p_resource_type: string
        }
        Returns: undefined
      }
      system_issue_access_token: {
        Args: {
          p_beneficiary_id: string
          p_dms_id?: string
          p_expires_at: string
          p_grant_type: Database["public"]["Enums"]["access_grant_type"]
          p_request_id?: string
          p_scope: Json
          p_token_hash: string
        }
        Returns: string
      }
      system_mark_token_delivered: {
        Args: { p_provider_message_id?: string; p_token_id: string }
        Returns: undefined
      }
      system_reissue_access_token: {
        Args: {
          p_expires_at: string
          p_previous_token_id: string
          p_reason: Database["public"]["Enums"]["token_revoked_reason"]
          p_token_hash: string
        }
        Returns: string
      }
      unassign_beneficiary: {
        Args: { p_assignment_id: string; p_corr?: string }
        Returns: undefined
      }
      update_ai_draft: {
        Args: { p_content_encrypted: Json; p_corr?: string; p_draft_id: string }
        Returns: string
      }
    }
    Enums: {
      access_grant_type: "DIRECT_SHARE" | "DMS_RELEASE" | "EMERGENCY_ACCESS"
      ai_draft_kind: "WILL_DRAFT" | "DOCUMENT_ANALYSIS"
      ai_draft_status:
        | "DRAFT"
        | "PENDING_CONFIRMATION"
        | "CONFIRMED"
        | "REJECTED"
        | "SUPERSEDED"
      ai_session_type: "ASSISTANT" | "WILL_GENERATOR" | "DOCUMENT_ANALYSIS"
      ai_version_author: "AI" | "USER"
      assignment_resource_type:
        | "FINANCIAL_ASSET"
        | "PHYSICAL_ASSET"
        | "DIGITAL_ASSET"
        | "DOCUMENT"
        | "VIDEO_MESSAGE"
      attachment_resource_type:
        | "FINANCIAL_ASSET"
        | "PHYSICAL_ASSET"
        | "DIGITAL_ASSET"
        | "LEGACY_PLAN"
      audit_outcome: "SUCCESS" | "FAILURE" | "DENIED"
      beneficiary_status: "PENDING" | "ACTIVE" | "INACTIVE"
      delivery_condition: "IMMEDIATE" | "DEAD_MAN_SWITCH" | "EMERGENCY_ACCESS"
      digital_asset_category:
        | "CRYPTO_WALLET"
        | "ONLINE_ACCOUNT"
        | "DOMAIN"
        | "SUBSCRIPTION"
        | "SOCIAL_MEDIA"
        | "OTHER"
      dms_event_type:
        | "CHECK_IN"
        | "MISSED_CHECK_IN"
        | "ESCALATION_STEP"
        | "RECOVERY"
        | "RELEASE"
        | "PAUSE"
        | "RESUME"
        | "CONFIG_CHANGE"
      dms_status:
        | "INACTIVE"
        | "ACTIVE"
        | "REMINDER_SENT"
        | "GRACE_PERIOD"
        | "ESCALATING"
        | "RELEASING"
        | "RELEASED"
        | "PAUSED"
      ea_config_status: "ACTIVE" | "INACTIVE"
      ea_decided_by: "OWNER" | "SYSTEM"
      ea_on_timeout: "WAIT" | "AUTO_GRANT" | "DENY"
      ea_request_status:
        | "PENDING"
        | "VERIFYING"
        | "VERIFIED"
        | "FAILED"
        | "APPROVED"
        | "DENIED"
        | "AUTO_GRANTED"
        | "EXPIRED"
        | "ACTIVE"
        | "REVOKED"
      ea_revoked_by: "OWNER" | "SYSTEM" | "EXPIRY"
      ea_verification_method: "EMAIL_OTP"
      encryption_mode: "PROVIDER_SSE" | "APP_ENVELOPE"
      financial_asset_category:
        | "BANK_ACCOUNT"
        | "FIXED_DEPOSIT"
        | "MUTUAL_FUND"
        | "STOCK"
        | "INSURANCE"
        | "RETIREMENT"
      job_status: "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "DEAD"
      legacy_plan_status: "DRAFT" | "FINALIZED"
      notification_channel: "EMAIL" | "IN_APP" | "BOTH"
      notification_delivery_status:
        | "PENDING"
        | "SENT"
        | "DELIVERED"
        | "BOUNCED"
        | "FAILED"
      physical_asset_category:
        | "REAL_ESTATE"
        | "VEHICLE"
        | "GOLD_JEWELRY"
        | "PERSONAL_PROPERTY"
        | "BUSINESS_ASSET"
      scan_status: "PENDING" | "CLEAN" | "INFECTED" | "ERROR" | "NOT_SCANNED"
      token_revoked_reason:
        | "OWNER"
        | "BENEFICIARY_INACTIVE"
        | "BENEFICIARY_REMOVED"
        | "RECOVERY"
        | "EXPIRED"
        | "UNDELIVERED_REPLACED"
        | "RESENT"
        | "ADMIN"
      upload_kind: "DOCUMENT" | "DOCUMENT_VERSION" | "VIDEO"
      upload_status:
        | "PENDING"
        | "UPLOADED"
        | "VALIDATING"
        | "VALIDATED"
        | "SCANNING"
        | "SCANNED_CLEAN"
        | "PROMOTED"
        | "REJECTED"
        | "EXPIRED"
      user_role: "USER" | "SUPER_ADMIN"
      webhook_provider: "CLERK" | "EMAIL"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      access_grant_type: ["DIRECT_SHARE", "DMS_RELEASE", "EMERGENCY_ACCESS"],
      ai_draft_kind: ["WILL_DRAFT", "DOCUMENT_ANALYSIS"],
      ai_draft_status: [
        "DRAFT",
        "PENDING_CONFIRMATION",
        "CONFIRMED",
        "REJECTED",
        "SUPERSEDED",
      ],
      ai_session_type: ["ASSISTANT", "WILL_GENERATOR", "DOCUMENT_ANALYSIS"],
      ai_version_author: ["AI", "USER"],
      assignment_resource_type: [
        "FINANCIAL_ASSET",
        "PHYSICAL_ASSET",
        "DIGITAL_ASSET",
        "DOCUMENT",
        "VIDEO_MESSAGE",
      ],
      attachment_resource_type: [
        "FINANCIAL_ASSET",
        "PHYSICAL_ASSET",
        "DIGITAL_ASSET",
        "LEGACY_PLAN",
      ],
      audit_outcome: ["SUCCESS", "FAILURE", "DENIED"],
      beneficiary_status: ["PENDING", "ACTIVE", "INACTIVE"],
      delivery_condition: ["IMMEDIATE", "DEAD_MAN_SWITCH", "EMERGENCY_ACCESS"],
      digital_asset_category: [
        "CRYPTO_WALLET",
        "ONLINE_ACCOUNT",
        "DOMAIN",
        "SUBSCRIPTION",
        "SOCIAL_MEDIA",
        "OTHER",
      ],
      dms_event_type: [
        "CHECK_IN",
        "MISSED_CHECK_IN",
        "ESCALATION_STEP",
        "RECOVERY",
        "RELEASE",
        "PAUSE",
        "RESUME",
        "CONFIG_CHANGE",
      ],
      dms_status: [
        "INACTIVE",
        "ACTIVE",
        "REMINDER_SENT",
        "GRACE_PERIOD",
        "ESCALATING",
        "RELEASING",
        "RELEASED",
        "PAUSED",
      ],
      ea_config_status: ["ACTIVE", "INACTIVE"],
      ea_decided_by: ["OWNER", "SYSTEM"],
      ea_on_timeout: ["WAIT", "AUTO_GRANT", "DENY"],
      ea_request_status: [
        "PENDING",
        "VERIFYING",
        "VERIFIED",
        "FAILED",
        "APPROVED",
        "DENIED",
        "AUTO_GRANTED",
        "EXPIRED",
        "ACTIVE",
        "REVOKED",
      ],
      ea_revoked_by: ["OWNER", "SYSTEM", "EXPIRY"],
      ea_verification_method: ["EMAIL_OTP"],
      encryption_mode: ["PROVIDER_SSE", "APP_ENVELOPE"],
      financial_asset_category: [
        "BANK_ACCOUNT",
        "FIXED_DEPOSIT",
        "MUTUAL_FUND",
        "STOCK",
        "INSURANCE",
        "RETIREMENT",
      ],
      job_status: ["QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "DEAD"],
      legacy_plan_status: ["DRAFT", "FINALIZED"],
      notification_channel: ["EMAIL", "IN_APP", "BOTH"],
      notification_delivery_status: [
        "PENDING",
        "SENT",
        "DELIVERED",
        "BOUNCED",
        "FAILED",
      ],
      physical_asset_category: [
        "REAL_ESTATE",
        "VEHICLE",
        "GOLD_JEWELRY",
        "PERSONAL_PROPERTY",
        "BUSINESS_ASSET",
      ],
      scan_status: ["PENDING", "CLEAN", "INFECTED", "ERROR", "NOT_SCANNED"],
      token_revoked_reason: [
        "OWNER",
        "BENEFICIARY_INACTIVE",
        "BENEFICIARY_REMOVED",
        "RECOVERY",
        "EXPIRED",
        "UNDELIVERED_REPLACED",
        "RESENT",
        "ADMIN",
      ],
      upload_kind: ["DOCUMENT", "DOCUMENT_VERSION", "VIDEO"],
      upload_status: [
        "PENDING",
        "UPLOADED",
        "VALIDATING",
        "VALIDATED",
        "SCANNING",
        "SCANNED_CLEAN",
        "PROMOTED",
        "REJECTED",
        "EXPIRED",
      ],
      user_role: ["USER", "SUPER_ADMIN"],
      webhook_provider: ["CLERK", "EMAIL"],
    },
  },
} as const

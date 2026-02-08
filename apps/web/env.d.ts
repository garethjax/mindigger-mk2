/// <reference types="astro/client" />
/// <reference types="@types/google.maps" />

declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User;
    profile: {
      role: "admin" | "business";
      full_name: string | null;
      account_enabled: boolean;
      account_locked: boolean;
    } | null;
  }
}

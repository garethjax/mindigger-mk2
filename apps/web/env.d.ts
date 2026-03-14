/// <reference types="astro/client" />
/// <reference types="@types/google.maps" />

declare module "bun:test" {
  export const describe: (label: string, fn: () => void) => void;
  export const test: (label: string, fn: () => void | Promise<void>) => void;
  export const expect: (value: unknown) => {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    resolves: {
      toBe(expected: unknown): Promise<void>;
      toEqual(expected: unknown): Promise<void>;
    };
  };
}

declare namespace App {
  interface Locals {
    user: import("@supabase/supabase-js").User;
    profile: {
      role: "admin" | "business";
      full_name: string | null;
      business_id: string | null;
      account_enabled: boolean;
      account_locked: boolean;
    } | null;
  }
}

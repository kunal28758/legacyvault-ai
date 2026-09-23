"use client";

import { useCallback, useState } from "react";

import type { PlanSectionKey } from "@/lib/types/legacy-plan";

import { useWizard } from "./wizard-provider";

/**
 * Local form state for one plan section, seeded from the saved draft and
 * auto-saved through the wizard provider on every change.
 */
export function useSectionForm<T extends Record<string, unknown>>(
  key: PlanSectionKey,
  defaults: T,
) {
  const { getSection, updateSection, errors, clearError, readOnly } = useWizard();
  const [values, setValues] = useState<T>(() => getSection(key, defaults));

  // `updateSection` writes to the wizard provider, so it must stay out of the
  // `setValues` updater — React runs updaters during render, and updating
  // another component from there is a setState-in-render bug.
  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      const nextValues = { ...values, [field]: value };
      setValues(nextValues);
      updateSection(key, nextValues);
      clearError(String(field));
    },
    [values, key, updateSection, clearError],
  );

  const setAll = useCallback(
    (nextValues: T) => {
      setValues(nextValues);
      updateSection(key, nextValues);
    },
    [key, updateSection],
  );

  return { values, setField, setAll, errors, readOnly };
}

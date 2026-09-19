"use client";

import { useCallback, useState } from "react";

import type { PlanSectionKey } from "@/lib/demo/types";

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

  const setField = useCallback(
    <K extends keyof T>(field: K, value: T[K]) => {
      setValues((prev) => {
        const nextValues = { ...prev, [field]: value };
        updateSection(key, nextValues);
        return nextValues;
      });
      clearError(String(field));
    },
    [key, updateSection, clearError],
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

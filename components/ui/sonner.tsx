"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--glass-border)",
          "--border-radius": "calc(var(--radius) * 1.1)",
          // richColors: one semantic colour per outcome, on the navy surface.
          "--success-bg": "color-mix(in oklch, var(--success) 12%, var(--popover))",
          "--success-border": "color-mix(in oklch, var(--success) 35%, transparent)",
          "--success-text": "var(--success)",
          "--info-bg": "color-mix(in oklch, var(--brand-blue) 12%, var(--popover))",
          "--info-border": "color-mix(in oklch, var(--brand-blue) 35%, transparent)",
          "--info-text": "var(--brand-blue)",
          "--warning-bg": "color-mix(in oklch, var(--warning) 12%, var(--popover))",
          "--warning-border": "color-mix(in oklch, var(--warning) 35%, transparent)",
          "--warning-text": "var(--warning)",
          "--error-bg": "color-mix(in oklch, var(--destructive) 12%, var(--popover))",
          "--error-border": "color-mix(in oklch, var(--destructive) 35%, transparent)",
          "--error-text": "var(--destructive)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast shadow-elevated! backdrop-blur-xl",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

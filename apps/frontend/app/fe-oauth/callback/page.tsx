"use client";

import { Suspense } from "react";

import OAuthCallback from "@/components/OAuthCallback";
import { useTranslations } from "@/hooks/useTranslations";

function LoadingFallback() {
  const { t } = useTranslations();
  return <div>{t("common:loading")}</div>;
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={<LoadingFallback />}>
      <OAuthCallback />
    </Suspense>
  );
}

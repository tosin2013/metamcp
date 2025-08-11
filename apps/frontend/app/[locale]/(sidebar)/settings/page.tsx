"use client";

import React, { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTranslations } from "@/hooks/useTranslations";
import { trpc } from "@/lib/trpc";

export default function SettingsPage() {
  const { t } = useTranslations();
  const [isSignupDisabled, setIsSignupDisabled] = useState(false);
  const [mcpResetTimeoutOnProgress, setMcpResetTimeoutOnProgress] =
    useState(true);
  const [mcpTimeout, setMcpTimeout] = useState(60000);
  const [mcpMaxTotalTimeout, setMcpMaxTotalTimeout] = useState(60000);

  // Get current signup disabled status
  const {
    data: signupDisabled,
    isLoading: signupLoading,
    refetch: refetchSignup,
  } = trpc.frontend.config.getSignupDisabled.useQuery();

  // Get current MCP timeout settings
  const {
    data: mcpResetTimeoutOnProgressData,
    isLoading: mcpResetLoading,
    refetch: refetchMcpReset,
  } = trpc.frontend.config.getMcpResetTimeoutOnProgress.useQuery();

  const {
    data: mcpTimeoutData,
    isLoading: mcpTimeoutLoading,
    refetch: refetchMcpTimeout,
  } = trpc.frontend.config.getMcpTimeout.useQuery();

  const {
    data: mcpMaxTotalTimeoutData,
    isLoading: mcpMaxTotalLoading,
    refetch: refetchMcpMaxTotal,
  } = trpc.frontend.config.getMcpMaxTotalTimeout.useQuery();

  // Mutations
  const setSignupDisabledMutation =
    trpc.frontend.config.setSignupDisabled.useMutation({
      onSuccess: () => {
        refetchSignup();
      },
    });

  const setMcpResetTimeoutOnProgressMutation =
    trpc.frontend.config.setMcpResetTimeoutOnProgress.useMutation({
      onSuccess: () => {
        refetchMcpReset();
      },
    });

  const setMcpTimeoutMutation = trpc.frontend.config.setMcpTimeout.useMutation({
    onSuccess: () => {
      refetchMcpTimeout();
    },
  });

  const setMcpMaxTotalTimeoutMutation =
    trpc.frontend.config.setMcpMaxTotalTimeout.useMutation({
      onSuccess: () => {
        refetchMcpMaxTotal();
      },
    });

  // Update local state when data is loaded
  React.useEffect(() => {
    if (signupDisabled !== undefined) {
      setIsSignupDisabled(signupDisabled);
    }
  }, [signupDisabled]);

  React.useEffect(() => {
    if (mcpResetTimeoutOnProgressData !== undefined) {
      setMcpResetTimeoutOnProgress(mcpResetTimeoutOnProgressData);
    }
  }, [mcpResetTimeoutOnProgressData]);

  React.useEffect(() => {
    if (mcpTimeoutData !== undefined) {
      setMcpTimeout(mcpTimeoutData);
    }
  }, [mcpTimeoutData]);

  React.useEffect(() => {
    if (mcpMaxTotalTimeoutData !== undefined) {
      setMcpMaxTotalTimeout(mcpMaxTotalTimeoutData);
    }
  }, [mcpMaxTotalTimeoutData]);

  const handleSignupToggle = async (checked: boolean) => {
    setIsSignupDisabled(checked);
    try {
      await setSignupDisabledMutation.mutateAsync({ disabled: checked });
    } catch (error) {
      setIsSignupDisabled(!checked);
      console.error("Failed to update signup setting:", error);
    }
  };

  const handleMcpResetTimeoutToggle = async (checked: boolean) => {
    setMcpResetTimeoutOnProgress(checked);
    try {
      await setMcpResetTimeoutOnProgressMutation.mutateAsync({
        enabled: checked,
      });
    } catch (error) {
      setMcpResetTimeoutOnProgress(!checked);
      console.error("Failed to update MCP reset timeout setting:", error);
    }
  };

  const handleMcpTimeoutChange = async (value: string) => {
    const timeout = parseInt(value, 10);
    if (isNaN(timeout) || timeout < 1000 || timeout > 300000) return;

    setMcpTimeout(timeout);
    try {
      await setMcpTimeoutMutation.mutateAsync({ timeout });
    } catch (error) {
      setMcpTimeout(mcpTimeoutData || 60000);
      console.error("Failed to update MCP timeout setting:", error);
    }
  };

  const handleMcpMaxTotalTimeoutChange = async (value: string) => {
    const timeout = parseInt(value, 10);
    if (isNaN(timeout) || timeout < 1000 || timeout > 300000) return;

    setMcpMaxTotalTimeout(timeout);
    try {
      await setMcpMaxTotalTimeoutMutation.mutateAsync({ timeout });
    } catch (error) {
      setMcpMaxTotalTimeout(mcpMaxTotalTimeoutData || 60000);
      console.error("Failed to update MCP max total timeout setting:", error);
    }
  };

  const isLoading =
    signupLoading || mcpResetLoading || mcpTimeoutLoading || mcpMaxTotalLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("settings:title")}
          </h1>
          <p className="text-muted-foreground">{t("settings:description")}</p>
        </div>
        <div>{t("settings:loading")}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t("settings:title")}
        </h1>
        <p className="text-muted-foreground">{t("settings:description")}</p>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("settings:authSettings")}</CardTitle>
            <CardDescription>
              {t("settings:authSettingsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="disable-signup" className="text-base">
                  {t("settings:disableSignup")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings:disableSignupDescription")}
                </p>
              </div>
              <Switch
                id="disable-signup"
                checked={isSignupDisabled}
                onCheckedChange={handleSignupToggle}
                disabled={setSignupDisabledMutation.isPending}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("settings:mcpSettings")}</CardTitle>
            <CardDescription>
              {t("settings:mcpSettingsDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="mcp-reset-timeout" className="text-base">
                  {t("settings:mcpResetTimeoutOnProgress")}
                </Label>
                <p className="text-sm text-muted-foreground">
                  {t("settings:mcpResetTimeoutOnProgressDescription")}
                </p>
              </div>
              <Switch
                id="mcp-reset-timeout"
                checked={mcpResetTimeoutOnProgress}
                onCheckedChange={handleMcpResetTimeoutToggle}
                disabled={setMcpResetTimeoutOnProgressMutation.isPending}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-timeout" className="text-base">
                {t("settings:mcpTimeout")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings:mcpTimeoutDescription")}
              </p>
              <div className="flex items-center space-x-2">
                <Input
                  id="mcp-timeout"
                  type="number"
                  min="1000"
                  max="300000"
                  value={mcpTimeout}
                  onChange={(e) => handleMcpTimeoutChange(e.target.value)}
                  onBlur={(e) => handleMcpTimeoutChange(e.target.value)}
                  disabled={setMcpTimeoutMutation.isPending}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">ms</span>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="mcp-max-total-timeout" className="text-base">
                {t("settings:mcpMaxTotalTimeout")}
              </Label>
              <p className="text-sm text-muted-foreground">
                {t("settings:mcpMaxTotalTimeoutDescription")}
              </p>
              <div className="flex items-center space-x-2">
                <Input
                  id="mcp-max-total-timeout"
                  type="number"
                  min="1000"
                  max="300000"
                  value={mcpMaxTotalTimeout}
                  onChange={(e) =>
                    handleMcpMaxTotalTimeoutChange(e.target.value)
                  }
                  onBlur={(e) => handleMcpMaxTotalTimeoutChange(e.target.value)}
                  disabled={setMcpMaxTotalTimeoutMutation.isPending}
                  className="w-32"
                />
                <span className="text-sm text-muted-foreground">ms</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

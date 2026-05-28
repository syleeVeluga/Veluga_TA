/**
 * Remote Control Settings Panel
 * Composes messenger remote control configuration.
 */

import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { GatewayControlCard } from './remote/GatewayControlCard';
import { PairingRequestsSection } from './remote/PairingRequestsSection';
import { PairingGuideCard } from './remote/PairingGuideCard';
import { ConfigStepNav } from './remote/ConfigStepNav';
import { DiscordConfigStep } from './remote/DiscordConfigStep';
import { SlackConfigStep } from './remote/SlackConfigStep';
import { AdvancedConfigStep } from './remote/AdvancedConfigStep';
import { AuthorizedUsersSection } from './remote/AuthorizedUsersSection';
import { QuickStartGuide } from './remote/QuickStartGuide';
import type {
  GatewayStatus,
  PairedUser,
  PairingRequest,
  RemoteConfig,
  ConfigStep,
  LocalizedBanner,
  DmPolicy,
} from './remote/types';

const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

export function RemoteControlPanel({ isActive }: { isActive: boolean }) {
  const { t } = useTranslation();

  const [isLoading, setIsLoading] = useState(true);
  const [status, setStatus] = useState<GatewayStatus | null>(null);
  const [, setConfig] = useState<RemoteConfig | null>(null);
  const [pairedUsers, setPairedUsers] = useState<PairedUser[]>([]);
  const [pendingPairings, setPendingPairings] = useState<PairingRequest[]>([]);
  const [isTogglingGateway, setIsTogglingGateway] = useState(false);
  const [error, setError] = useState<LocalizedBanner | null>(null);
  const [success, setSuccess] = useState<LocalizedBanner | null>(null);
  const [activeStep, setActiveStep] = useState<ConfigStep>('discord');

  const [discordBotToken, setDiscordBotToken] = useState('');
  const [discordApplicationId, setDiscordApplicationId] = useState('');
  const [discordDmPolicy, setDiscordDmPolicy] = useState<DmPolicy>('pairing');

  const [slackBotToken, setSlackBotToken] = useState('');
  const [slackAppToken, setSlackAppToken] = useState('');
  const [slackSigningSecret, setSlackSigningSecret] = useState('');
  const [slackUseSocketMode, setSlackUseSocketMode] = useState(true);
  const [slackDmPolicy, setSlackDmPolicy] = useState<DmPolicy>('pairing');

  const [gatewayPort, setGatewayPort] = useState(18789);
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState('');
  const [autoApproveSafeTools, setAutoApproveSafeTools] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  // Tracks which channels were persisted at load time so saveConfig can detect
  // "user cleared the token" and propagate the clear back to disk.
  const persistedDiscord = useRef(false);
  const persistedSlack = useRef(false);

  useEffect(() => {
    if (!isActive) return;
    loadData();
    const interval = setInterval(refreshStatus, 5000);
    return () => clearInterval(interval);
  }, [isActive]);

  async function loadData() {
    if (!isElectron) return;
    setIsLoading(true);
    try {
      const [configResult, statusResult, usersResult, pairingsResult] = await Promise.all([
        window.electronAPI.remote.getConfig(),
        window.electronAPI.remote.getStatus(),
        window.electronAPI.remote.getPairedUsers(),
        window.electronAPI.remote.getPendingPairings(),
      ]);

      setConfig(configResult);
      setStatus(statusResult);
      setPairedUsers(usersResult);
      setPendingPairings(pairingsResult);

      if (configResult) {
        setGatewayPort(configResult.gateway?.port || 18789);
        setDefaultWorkingDirectory(configResult.gateway?.defaultWorkingDirectory || '');
        setAutoApproveSafeTools(configResult.gateway?.autoApproveSafeTools !== false);

        const discord = configResult.channels?.discord;
        persistedDiscord.current = !!discord?.botToken;
        if (discord) {
          setDiscordBotToken(discord.botToken || '');
          setDiscordApplicationId(discord.applicationId || '');
          setDiscordDmPolicy(discord.dm?.policy || 'pairing');
        }

        const slack = configResult.channels?.slack;
        persistedSlack.current = !!slack?.botToken;
        if (slack) {
          setSlackBotToken(slack.botToken || '');
          setSlackAppToken(slack.appToken || '');
          setSlackSigningSecret(slack.signingSecret || '');
          setSlackUseSocketMode(slack.useSocketMode !== false);
          setSlackDmPolicy(slack.dm?.policy || 'pairing');
        }
      }
    } catch (err) {
      console.error('Failed to load remote config:', err);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshStatus() {
    if (!isElectron) return;
    try {
      const [statusResult, pairingsResult] = await Promise.all([
        window.electronAPI.remote.getStatus(),
        window.electronAPI.remote.getPendingPairings(),
      ]);
      setStatus(statusResult);
      setPendingPairings(pairingsResult);
    } catch (err) {
      console.error('Failed to refresh status:', err);
    }
  }

  async function toggleGateway() {
    if (!isElectron || isTogglingGateway) return;
    setIsTogglingGateway(true);
    setError(null);
    try {
      const newEnabled = !status?.running;
      await window.electronAPI.remote.setEnabled(newEnabled);
      await refreshStatus();
      setSuccess({ key: newEnabled ? 'remote.started' : 'remote.stopped' });
      setTimeout(() => setSuccess(null), 3000);
    } catch {
      setError({ key: 'remote.actionFailed' });
    } finally {
      setIsTogglingGateway(false);
    }
  }

  async function saveConfig() {
    if (!isElectron) return;
    setIsSaving(true);
    setError(null);
    try {
      await window.electronAPI.remote.updateGatewayConfig({
        port: gatewayPort,
        defaultWorkingDirectory: defaultWorkingDirectory || undefined,
        autoApproveSafeTools,
      });

      // Push update when the user currently has values OR when they previously did and
      // are now clearing them — empty botToken disables the channel at registerChannels.
      if (discordBotToken || persistedDiscord.current) {
        await window.electronAPI.remote.updateDiscordConfig({
          type: 'discord',
          botToken: discordBotToken,
          applicationId: discordApplicationId || undefined,
          dm: { policy: discordDmPolicy },
        });
      }

      if (slackBotToken || persistedSlack.current) {
        await window.electronAPI.remote.updateSlackConfig({
          type: 'slack',
          botToken: slackBotToken,
          appToken: slackAppToken || undefined,
          signingSecret: slackSigningSecret || undefined,
          useSocketMode: slackUseSocketMode,
          dm: { policy: slackDmPolicy },
        });
      }

      setSuccess({ key: 'remote.configSaved' });
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch {
      setError({ key: 'remote.saveFailed' });
    } finally {
      setIsSaving(false);
    }
  }

  async function approvePairing(request: PairingRequest) {
    if (!isElectron) return;
    try {
      await window.electronAPI.remote.approvePairing(request.channelType, request.userId);
      setSuccess({ key: 'remote.pairingApproved' });
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch {
      setError({ key: 'remote.approveFailed' });
    }
  }

  async function rejectPairing(request: PairingRequest) {
    if (!isElectron) return;
    try {
      const result = await window.electronAPI.remote.rejectPairing(
        request.channelType,
        request.userId
      );
      if (!result.success) {
        setError(result.error ? { text: result.error } : { key: 'remote.rejectFailed' });
        return;
      }
      setSuccess({ key: 'remote.pairingRejected' });
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch {
      setError({ key: 'remote.rejectFailed' });
    }
  }

  async function revokePairing(user: PairedUser) {
    if (!isElectron) return;
    try {
      await window.electronAPI.remote.revokePairing(user.channelType, user.userId);
      setSuccess({ key: 'remote.userRemoved' });
      setTimeout(() => setSuccess(null), 3000);
      await loadData();
    } catch {
      setError({ key: 'remote.revokeFailed' });
    }
  }

  const isDiscordConfigured = !!discordBotToken;
  const isSlackConfigured = !!slackBotToken;
  const isChannelConfigured = isDiscordConfigured || isSlackConfigured;
  const activePairingPolicy = isDiscordConfigured ? discordDmPolicy : slackDmPolicy;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-accent" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {error && (
        <div className="p-4 bg-error/10 border border-error/30 rounded-xl flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-error flex-shrink-0" />
          <span className="text-error">{error.key ? t(error.key) : error.text}</span>
        </div>
      )}
      {success && (
        <div className="p-4 bg-success/10 border border-success/30 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-success flex-shrink-0" />
          <span className="text-success">{success.key ? t(success.key) : success.text}</span>
        </div>
      )}

      <GatewayControlCard
        status={status}
        pairedUsers={pairedUsers}
        pendingPairings={pendingPairings}
        isTogglingGateway={isTogglingGateway}
        isChannelConfigured={isChannelConfigured}
        onToggle={toggleGateway}
      />

      {status?.running && activePairingPolicy === 'pairing' && <PairingGuideCard />}

      <PairingRequestsSection
        pendingPairings={pendingPairings}
        showEmpty={status?.running && activePairingPolicy === 'pairing'}
        onApprove={approvePairing}
        onReject={rejectPairing}
      />

      <ConfigStepNav
        activeStep={activeStep}
        isDiscordConfigured={isDiscordConfigured}
        isSlackConfigured={isSlackConfigured}
        onStepChange={setActiveStep}
      />

      <div className="p-6 rounded-[2rem] border border-border-subtle bg-background/60">
        {activeStep === 'discord' && (
          <DiscordConfigStep
            botToken={discordBotToken}
            applicationId={discordApplicationId}
            dmPolicy={discordDmPolicy}
            onBotTokenChange={setDiscordBotToken}
            onApplicationIdChange={setDiscordApplicationId}
            onDmPolicyChange={setDiscordDmPolicy}
          />
        )}
        {activeStep === 'slack' && (
          <SlackConfigStep
            botToken={slackBotToken}
            appToken={slackAppToken}
            signingSecret={slackSigningSecret}
            useSocketMode={slackUseSocketMode}
            dmPolicy={slackDmPolicy}
            onBotTokenChange={setSlackBotToken}
            onAppTokenChange={setSlackAppToken}
            onSigningSecretChange={setSlackSigningSecret}
            onSocketModeChange={setSlackUseSocketMode}
            onDmPolicyChange={setSlackDmPolicy}
          />
        )}
        {activeStep === 'advanced' && (
          <AdvancedConfigStep
            defaultWorkingDirectory={defaultWorkingDirectory}
            gatewayPort={gatewayPort}
            autoApproveSafeTools={autoApproveSafeTools}
            onWorkingDirectoryChange={setDefaultWorkingDirectory}
            onGatewayPortChange={setGatewayPort}
            onAutoApproveChange={setAutoApproveSafeTools}
          />
        )}

        <div className="flex justify-end mt-6 pt-6 border-t border-border">
          <button
            onClick={saveConfig}
            disabled={isSaving}
            className="flex items-center gap-2 px-6 py-2.5 bg-accent hover:bg-accent/90 text-white rounded-xl font-medium transition-colors disabled:opacity-50"
          >
            {isSaving ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Check className="w-4 h-4" />
            )}
            {t('remote.saveConfig')}
          </button>
        </div>
      </div>

      <AuthorizedUsersSection pairedUsers={pairedUsers} onRevoke={revokePairing} />

      <QuickStartGuide />
    </div>
  );
}

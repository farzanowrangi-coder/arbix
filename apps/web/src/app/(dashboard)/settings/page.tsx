'use client';

import { useState } from 'react';
import useSWR from 'swr';
import toast from 'react-hot-toast';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store';
import { useOddsFormat, type OddsFormat } from '@/context/OddsFormatContext';

const fetcher = (url: string) => api.get(url).then((r) => r.data.data);
const TABS = ['Profile', 'Display', 'Notifications', 'Filters', 'Subscription'] as const;
type Tab = typeof TABS[number];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>('Profile');
  const user = useAuthStore((s) => s.user);
  const { format, setFormat } = useOddsFormat();
  const { data: notifSettings, mutate: reloadNotif } = useSWR('/notifications/settings', fetcher);
  const { data: subStatus } = useSWR('/subscription/status', fetcher);
  const [saving, setSaving] = useState(false);

  async function saveNotifications(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const channels = ['browser', 'telegram', 'discord', 'email'].filter((c) => fd.get(c) === 'on');
    setSaving(true);
    try {
      await api.put('/notifications/settings', {
        channels,
        telegramChatId: fd.get('telegramChatId') || null,
        discordWebhookUrl: fd.get('discordWebhookUrl') || null,
        minRoiThreshold: parseFloat(fd.get('minRoiThreshold') as string) || 1,
      });
      await reloadNotif();
      toast.success('Notification settings saved');
    } catch {
      toast.error('Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  async function openStripePortal() {
    try {
      const res = await api.post('/subscription/portal');
      window.location.href = res.data.data.url;
    } catch {
      toast.error('Failed to open billing portal');
    }
  }

  async function upgradePlan(tier: 'basic' | 'pro') {
    try {
      const res = await api.post('/subscription/checkout', { tier });
      window.location.href = res.data.data.url;
    } catch {
      toast.error('Failed to create checkout session');
    }
  }

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <h1 className="text-base font-bold text-text-primary">Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs transition-colors ${
              tab === t
                ? 'text-green-arb border-b-2 border-green-arb'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Profile Tab */}
      {tab === 'Profile' && (
        <div className="border border-border bg-card rounded-lg p-5 space-y-4">
          {[
            { label: 'Email', value: user?.email ?? '' },
            { label: 'Username', value: user?.username ?? '' },
            { label: 'Plan', value: (user?.subscriptionTier ?? 'free').toUpperCase() },
          ].map(({ label, value }) => (
            <div key={label}>
              <div className="text-2xs text-text-muted mb-1">{label}</div>
              <div className="text-sm text-text-primary bg-terminal border border-border rounded px-3 py-2">{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Display Tab */}
      {tab === 'Display' && (
        <div className="border border-border bg-card rounded-lg p-5 space-y-5">
          <div>
            <div className="text-xs font-bold text-text-primary mb-1">Odds Format</div>
            <div className="text-2xs text-text-muted mb-3">Choose how odds are displayed across the app.</div>
            <div className="flex gap-2">
              {([
                { value: 'decimal', label: 'Decimal', example: '2.500' },
                { value: 'american', label: 'American', example: '+150' },
              ] as { value: OddsFormat; label: string; example: string }[]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setFormat(opt.value)}
                  className={`flex-1 py-3 rounded-lg border text-center transition-all ${
                    format === opt.value
                      ? 'border-green-arb bg-green-arb/10 text-green-arb'
                      : 'border-border text-text-secondary hover:border-border/80 hover:text-text-primary'
                  }`}
                >
                  <div className="text-xs font-bold">{opt.label}</div>
                  <div className="text-lg font-mono mt-1">{opt.example}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Notifications Tab */}
      {tab === 'Notifications' && (
        <form onSubmit={saveNotifications} className="border border-border bg-card rounded-lg p-5 space-y-4">
          <h2 className="text-xs font-bold text-text-primary">Alert Channels</h2>
          {(['browser', 'telegram', 'discord', 'email'] as const).map((ch) => (
            <label key={ch} className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                name={ch}
                defaultChecked={notifSettings?.channels?.includes(ch)}
                className="accent-green-arb"
              />
              <span className="text-sm text-text-secondary capitalize">{ch}</span>
            </label>
          ))}

          <div>
            <label className="block text-2xs text-text-muted mb-1.5">Telegram Chat ID</label>
            <input
              name="telegramChatId"
              defaultValue={notifSettings?.telegramChatId ?? ''}
              placeholder="e.g. 123456789"
              className="w-full bg-terminal border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-green-arb/50"
            />
          </div>

          <div>
            <label className="block text-2xs text-text-muted mb-1.5">Discord Webhook URL</label>
            <input
              name="discordWebhookUrl"
              defaultValue={notifSettings?.discordWebhookUrl ?? ''}
              placeholder="https://discord.com/api/webhooks/..."
              className="w-full bg-terminal border border-border rounded px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:outline-none focus:border-green-arb/50"
            />
          </div>

          <div>
            <label className="block text-2xs text-text-muted mb-1.5">Minimum ROI to alert (%)</label>
            <input
              name="minRoiThreshold"
              type="number"
              step="0.1"
              min="0"
              defaultValue={notifSettings?.minRoiThreshold ?? 1}
              className="w-48 bg-terminal border border-border rounded px-3 py-2 text-sm text-text-primary focus:outline-none focus:border-green-arb/50"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2 bg-green-arb text-terminal font-bold text-sm rounded hover:bg-green-arb-dim disabled:opacity-50 transition-colors"
          >
            {saving ? 'Saving...' : 'Save Notifications'}
          </button>
        </form>
      )}

      {/* Filters Tab */}
      {tab === 'Filters' && (
        <div className="border border-border bg-card rounded-lg p-5 text-sm text-text-muted">
          Default filters can be set from the Opportunities page. Those preferences are saved automatically.
        </div>
      )}

      {/* Subscription Tab */}
      {tab === 'Subscription' && (
        <div className="border border-border bg-card rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-text-muted mb-1">Current Plan</div>
              <div className="text-base font-bold text-text-primary">
                {(subStatus?.tier ?? 'free').toUpperCase()}
              </div>
            </div>
            {subStatus?.subscriptionId && (
              <button
                onClick={openStripePortal}
                className="text-xs text-blue-arb border border-blue-arb/30 rounded px-3 py-1.5 hover:bg-blue-arb/10 transition-colors"
              >
                Manage Billing
              </button>
            )}
          </div>

          {subStatus?.tier === 'free' && (
            <div className="space-y-2">
              <div className="text-2xs text-text-muted mb-3">Upgrade to unlock full access</div>
              {(['basic', 'pro'] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => upgradePlan(tier)}
                  className={`w-full py-2 rounded text-sm font-bold transition-colors ${
                    tier === 'pro'
                      ? 'bg-green-arb text-terminal hover:bg-green-arb-dim shadow-neon-green'
                      : 'border border-border text-text-primary hover:border-green-arb/40'
                  }`}
                >
                  Upgrade to {tier.charAt(0).toUpperCase() + tier.slice(1)} {tier === 'basic' ? '— $29/mo' : '— $99/mo'}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

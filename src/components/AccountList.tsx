import { useState, useEffect, useMemo, useRef } from 'react';
import { Zap, RefreshCw, ArrowLeftRight, Trash2, Clock, UploadCloud, Plus, Gauge, UserPlus, Eye, EyeOff, Play } from 'lucide-react';
import { Account, AppSettings, LunaReserveWindow, RelayUsageCache, SparkWindows, effectiveKind } from '../hooks/useAccounts';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { isMacOS } from '../platform';
import { AntigravityQuota, type AntigravityModelQuota } from './AntigravityQuota';
import { AgyRelayModelQuotas, RelayQuotaWindows } from './RelayQuotaWindows';
import { relayCurrentState } from '../utils/relayCurrent';
import { formatViDateTime, formatViShortDateTime } from '../utils/dateFormat';
import { quotaWindowView } from '../utils/quotaWindows';
import { ReferralInviteModal } from './ReferralInviteModal';

const KIND_BADGE: Record<ReturnType<typeof effectiveKind>, { label: string; className: string }> = {
    chatgpt_oauth: { label: 'Đăng ký', className: 'badge kind-chatgpt' },
    openai_key: { label: 'API', className: 'badge kind-openai' },
    relay: { label: 'Relay', className: 'badge kind-relay' },
    antigravity_oauth: { label: 'Google', className: 'badge kind-antigravity' },
};

/** Relay 类账号在 row 上展示哪个标签。新字段 `relay_category` 是权威来源，
 * 缺失时回退到通用"中转"。 */
function relayCategoryBadge(account: Account): { label: string; className: string } {
    switch (account.relay_category) {
        case 'coding_plan':
            return { label: 'Plan', className: 'badge kind-codingplan' };
        case 'third_party':
            return { label: 'Bên thứ ba', className: 'badge kind-thirdparty' };
        case 'aggregator':
        default:
            return { label: 'Relay', className: 'badge kind-relay' };
    }
}

function antigravityModelQuotas(account: Account): Record<string, AntigravityModelQuota> {
    const auth = account.auth_json as { model_quotas?: Record<string, AntigravityModelQuota> } | null;
    return auth?.model_quotas ?? {};
}

function antigravityTier(account: Account): { label: string; className: string } {
    const tier = (account.auth_json as { subscription_tier?: string } | null)?.subscription_tier?.toLowerCase();
    if (tier?.includes('ultra')) return { label: 'ULTRA', className: 'badge google-tier google-tier-ultra' };
    if (tier?.includes('pro')) return { label: 'PRO', className: 'badge google-tier google-tier-pro' };
    if (tier?.includes('plus')) return { label: 'PLUS', className: 'badge google-tier google-tier-pro' };
    if (tier === 'free' || tier?.includes('starter')) return { label: 'FREE', className: 'badge google-tier google-tier-free' };
    return { label: 'Chưa nhận diện gói', className: 'badge google-tier google-tier-unknown' };
}

function antigravityQuotaUpdatedAt(account: Account): string | undefined {
    return Object.values(antigravityModelQuotas(account))
        .map(quota => quota.updated_at)
        .filter((value): value is string => !!value && Number.isFinite(Date.parse(value)))
        .sort((a, b) => Date.parse(b) - Date.parse(a))[0];
}
import { useShortCountdown } from '../hooks/useCountdown';
import './AccountList.css';
import { ConfirmModal } from './ConfirmModal';

/** 把 Unix 秒到期时间格式化成本地短时间，如 "07-18 00:34" */
function fmtExpiry(ts?: number | null): string {
    if (!ts || ts <= 0) return 'Chưa xác định';
    return formatViShortDateTime(ts * 1000);
}

/** 距到期还剩多少天（向下取整，过期返回 0；无时间返回 null） */
function daysLeft(ts?: number | null): number | null {
    if (!ts || ts <= 0) return null;
    return Math.max(0, Math.floor((ts - Math.floor(Date.now() / 1000)) / 86400));
}

type AccountExpiryInfo = {
    text: string;
    badge: string | null;
    tone: 'unset' | 'normal' | 'soon' | 'expired';
    title: string;
};

function expiryDateInputValue(value?: string | null): string {
    if (!value) return '';
    const isoDate = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());
    if (isoDate) return isoDate[1];
    const viDate = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value.trim());
    if (viDate) return `${viDate[3]}-${viDate[2]}-${viDate[1]}`;
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime())) return '';
    return [
        parsed.getFullYear(),
        String(parsed.getMonth() + 1).padStart(2, '0'),
        String(parsed.getDate()).padStart(2, '0'),
    ].join('-');
}

/** 手工账号到期日按本地自然日计算；到期当天仍显示“今天到期”。 */
function accountExpiryInfo(value?: string | null): AccountExpiryInfo {
    if (!value) {
        return { text: 'Chưa có dữ liệu', badge: null, tone: 'unset', title: 'Token chưa có thông tin ngày hết hạn gói' };
    }

    const raw = value.trim();
    let expiryMs: number;
    let parsed: Date;

    const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
    const vietnameseDateTime = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}):(\d{2}))?$/.exec(raw);
    if (dateOnly) {
        const year = Number(dateOnly[1]);
        const month = Number(dateOnly[2]);
        const day = Number(dateOnly[3]);
        parsed = new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
        if (
            parsed.getUTCFullYear() !== year ||
            parsed.getUTCMonth() !== month - 1 ||
            parsed.getUTCDate() !== day
        ) {
            return { text: raw, badge: 'Sai ngày', tone: 'unset', title: 'Ngày hết hạn không hợp lệ' };
        }
        expiryMs = parsed.getTime();
    } else if (vietnameseDateTime) {
        const day = Number(vietnameseDateTime[1]);
        const month = Number(vietnameseDateTime[2]);
        const year = Number(vietnameseDateTime[3]);
        const hour = Number(vietnameseDateTime[4] ?? 23);
        const minute = Number(vietnameseDateTime[5] ?? 59);
        const second = Number(vietnameseDateTime[6] ?? 59);
        parsed = new Date(year, month - 1, day, hour, minute, second);
        expiryMs = parsed.getTime();
    } else {
        expiryMs = Date.parse(raw);
        if (!Number.isFinite(expiryMs)) {
            return { text: raw, badge: 'Sai ngày', tone: 'unset', title: 'Ngày hết hạn không hợp lệ' };
        }
        parsed = new Date(expiryMs);
    }

    const remainingMs = expiryMs - Date.now();
    const remainingDays = Math.ceil(remainingMs / 86_400_000);
    const dateText = new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
    }).format(parsed);
    const fullText = new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    }).format(parsed);

    if (remainingMs < 0) {
        return {
            text: dateText,
            badge: 'Đã hết hạn',
            tone: 'expired',
            title: 'Đã hết hạn lúc ' + fullText,
        };
    }
    if (remainingDays <= 1) {
        return {
            text: dateText,
            badge: 'Sắp hết hạn',
            tone: 'soon',
            title: 'Hết hạn lúc ' + fullText,
        };
    }
    if (remainingDays <= 7) {
        return {
            text: dateText,
            badge: 'Còn ' + remainingDays + ' ngày',
            tone: 'soon',
            title: 'Hết hạn lúc ' + fullText,
        };
    }
    return {
        text: dateText,
        badge: null,
        tone: 'normal',
        title: 'Hết hạn lúc ' + fullText,
    };
}

function primingWindowKind(account: Account): 'five_hour' | 'weekly' {
    const seconds = account.cached_quota?.primary_window_seconds;
    if (typeof seconds === 'number' && seconds > 0) {
        return seconds >= 24 * 60 * 60 ? 'weekly' : 'five_hour';
    }
    const primaryLabel = account.cached_quota?.five_hour_label ?? '';
    if (/周|weekly|7\s*d/i.test(primaryLabel)) {
        return 'weekly';
    }
    return 'five_hour';
}


interface ResetCreditResult {
    ok: boolean;
    status_code: number;
    code: string;
    windows_reset: number;
    message: string;
    consumed_credit_id?: string | null;
    upstream_raw: string;
}

// 一条可用的「主动重置次数」（来自 GET wham/rate-limit-reset-credits）
interface ResetCreditItem {
    id: string;
    expires_at?: number | null; // Unix 秒
    granted_at?: number | null;
    title: string;
    source: string;
}

interface UsageData {
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    primary_window_seconds?: number | null;
    five_hour_label: string;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
    secondary_window_seconds?: number | null;
    weekly_label: string;
    plan_type: string;
    is_valid_for_cli: boolean;
    reset_credits?: number | null;
    spark?: SparkWindows | null;
    luna_reserve?: LunaReserveWindow | null;
}

type FilterType = 'all' | 'sub' | 'google' | 'plus' | 'pro' | 'team' | 'free' | 'relay' | 'coding_plan' | 'third_party';

interface AccountListProps {
    accounts: Account[];
    currentId: string | null;
    settings: AppSettings;
    onSwitch: (id: string) => void | Promise<void>;
    onDelete: (id: string) => void;
    onUpdateAccount: (id: string, name?: string, notes?: string, accountExpiresAt?: string) => Promise<void>;
    onUpdateSettings: (settings: AppSettings) => void | Promise<void>;
    onRefreshComplete?: () => void | Promise<void>;
    onAddAccount?: () => void;
    onAddRelay?: () => void;
    onRefreshUsage?: () => void;
    usageLoading?: boolean;
}

export function AccountList({
    accounts,
    currentId,
    settings,
    onSwitch,
    onAddAccount,
    onAddRelay,
    onRefreshUsage,
    usageLoading,
    onDelete,
    onUpdateAccount,
    onUpdateSettings,
    onRefreshComplete,
}: AccountListProps) {
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [refreshingIds, setRefreshingIds] = useState<Set<string>>(new Set());
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [switchingIds, setSwitchingIds] = useState<Set<string>>(new Set());
    const [savingPriorityIds, setSavingPriorityIds] = useState<Set<string>>(new Set());
    const [usageMap, setUsageMap] = useState<Record<string, UsageData>>({});
    const [isRefreshingAll, setIsRefreshingAll] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [filter, setFilter] = useState<FilterType>('all');
    const [invalidIds, setInvalidIds] = useState<Set<string>>(new Set());
    const [bannedIds, setBannedIds] = useState<Set<string>>(new Set());
    const [accountToDelete, setAccountToDelete] = useState<{ id: string, name: string } | null>(null);
    const [pushingIds, setPushingIds] = useState<Set<string>>(new Set());
    const [pushToast, setPushToast] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    // Relay 类型账号的余额缓存（与 ChatGPT usage 独立）
    const [relayUsageMap, setRelayUsageMap] = useState<Record<string, RelayUsageCache>>({});
    const [cookieEditor, setCookieEditor] = useState<{ id: string; name: string; value: string } | null>(null);
    const [savingCookie, setSavingCookie] = useState(false);
    // Codex 邀请弹窗
    const [inviteModal, setInviteModal] = useState<{ id: string; name: string } | null>(null);
    // Codex 启动：用该账号在隔离 CODEX_HOME 直连下开一个真 codex 终端
    const [launchingIds, setLaunchingIds] = useState<Set<string>>(new Set());
    // 主动重置：点徽章先弹窗列出所有重置次数（含到期时间），再消耗一次
    const [resetModal, setResetModal] = useState<{ id: string; name: string; credits: number | null } | null>(null);
    const resetQueryVersion = useRef(0);
    const [resetting, setResetting] = useState(false);
    const [resetList, setResetList] = useState<ResetCreditItem[] | null>(null);
    const [resetListLoading, setResetListLoading] = useState(false);
    const [resetListError, setResetListError] = useState<string | null>(null);
    // 月抛账号到期日：手工维护，与 OAuth token 的 expires_at 完全分开。
    const [expiryEditor, setExpiryEditor] = useState<{ id: string; name: string; value: string } | null>(null);
    const [savingExpiry, setSavingExpiry] = useState(false);
    const [expiryError, setExpiryError] = useState<string | null>(null);
    // 周期保鲜：跨过 reset_at 后按账号发一次最小 Codex 请求。
    const [primeEditor, setPrimeEditor] = useState<{
        id: string;
        name: string;
        fiveHour: boolean;
        weekly: boolean;
        mode: 'five_hour' | 'weekly';
        lastAttempt?: string | null;
        lastSuccess?: string | null;
        lastError?: string | null;
    } | null>(null);
    const [savingPrime, setSavingPrime] = useState(false);
    const [primeError, setPrimeError] = useState<string | null>(null);
    const [maskedIds, setMaskedIds] = useState<Set<string>>(new Set());
    const [warmingIds, setWarmingIds] = useState<Set<string>>(new Set());
    const [warmingAll, setWarmingAll] = useState(false);

    useEffect(() => {
        invoke<string[]>('get_masked_account_ids')
            .then(ids => setMaskedIds(new Set(ids)))
            .catch(error => console.error('Không tải được danh sách tài khoản đã ẩn:', error));
    }, []);

    const toggleMasked = async (id: string) => {
        const next = new Set(maskedIds);
        next.has(id) ? next.delete(id) : next.add(id);
        setMaskedIds(next);
        try {
            await invoke('set_masked_account_ids', { ids: Array.from(next) });
        } catch (error) {
            setMaskedIds(maskedIds);
            setPushToast({ type: 'error', text: `Không lưu được trạng thái ẩn: ${String(error)}` });
        }
    };

    const warmupOne = async (id: string, name: string) => {
        if (warmingIds.has(id)) return;
        setWarmingIds(prev => new Set(prev).add(id));
        setPrimeError(null);
        try {
            await invoke('send_codex_wakeup', { id, prompt: 'hi' });
            setPushToast({ type: 'success', text: `Đã kích hoạt cửa sổ hạn mức cho ${name}` });
            await onRefreshComplete?.();
        } catch (error) {
            setPrimeError(String(error));
            setPushToast({ type: 'error', text: `Không thể kích hoạt ${name}: ${String(error)}` });
        } finally {
            setWarmingIds(prev => { const next = new Set(prev); next.delete(id); return next; });
            setTimeout(() => setPushToast(null), 5000);
        }
    };

    const warmupAll = async () => {
        if (warmingAll) return;
        setWarmingAll(true);
        try {
            const result = await invoke<{ total_accounts: number; warmed_accounts: number; failed_account_ids: string[] }>('warmup_all_accounts');
            const suffix = result.failed_account_ids.length ? `; lỗi ${result.failed_account_ids.length}` : '';
            setPushToast({ type: result.failed_account_ids.length ? 'error' : 'success', text: `Đã kích hoạt ${result.warmed_accounts}/${result.total_accounts} tài khoản${suffix}` });
            await onRefreshComplete?.();
        } catch (error) {
            setPushToast({ type: 'error', text: `Không thể kích hoạt tất cả: ${String(error)}` });
        } finally {
            setWarmingAll(false);
            setTimeout(() => setPushToast(null), 5000);
        }
    };

    const autoReload = settings.auto_reload_ide;
    const setAutoReload = (val: boolean) => onUpdateSettings({ ...settings, auto_reload_ide: val });

    const saveAccountExpiry = async () => {
        if (!expiryEditor || savingExpiry) return;
        setSavingExpiry(true);
        setExpiryError(null);
        try {
            await onUpdateAccount(expiryEditor.id, undefined, undefined, expiryEditor.value);
            if (settings.remote_mode === 'client' || settings.remote_mode === 'solo') {
                try {
                    await invoke('remote_push_account', { id: expiryEditor.id });
                } catch (err) {
                    throw new Error(`Đã lưu trên máy nhưng không đồng bộ được với máy chủ: ${String(err)}`);
                }
            }
            onRefreshComplete?.();
            setExpiryEditor(null);
        } catch (err) {
            setExpiryError(String(err));
        } finally {
            setSavingExpiry(false);
        }
    };

    const saveWindowPriming = async () => {
        if (!primeEditor || savingPrime) return;
        setSavingPrime(true);
        setPrimeError(null);
        try {
            await invoke('set_account_window_priming', {
                id: primeEditor.id,
                fiveHourEnabled: primeEditor.fiveHour,
                weeklyEnabled: primeEditor.weekly,
            });
            if (settings.remote_mode === 'client' || settings.remote_mode === 'solo') {
                try {
                    await invoke('remote_push_account', { id: primeEditor.id });
                } catch (err) {
                    throw new Error(`Đã lưu trên máy nhưng không đồng bộ được với máy chủ: ${String(err)}`);
                }
            }
            onRefreshComplete?.();
            setPrimeEditor(null);
        } catch (err) {
            setPrimeError(String(err));
        } finally {
            setSavingPrime(false);
        }
    };

    const handleCopy = (id: string, text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        });
    };

    const savePriority = async (id: string, rawValue: string) => {
        if (savingPriorityIds.has(id)) return;
        const current = accounts.find(account => account.id === id)?.priority ?? 50;
        const parsed = Number.parseInt(rawValue, 10);
        const priority = Number.isFinite(parsed) ? Math.min(100, Math.max(1, parsed)) : current;
        if (priority === current) return;
        setSavingPriorityIds(prev => new Set(prev).add(id));
        try {
            await invoke('set_account_priority', { id, priority });
            if (settings.remote_mode === 'client' || settings.remote_mode === 'solo') {
                await invoke('remote_push_account', { id });
            }
            await onRefreshComplete?.();
            setPushToast({ type: 'success', text: `Đã đặt mức ưu tiên ${priority} (1 là cao nhất)` });
        } catch (error) {
            setPushToast({ type: 'error', text: `Không lưu được mức ưu tiên: ${String(error)}` });
            await onRefreshComplete?.();
        } finally {
            setSavingPriorityIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setTimeout(() => setPushToast(null), 4000);
        }
    };

    const handleLaunchCodex = async (id: string, name: string) => {
        if (launchingIds.has(id)) return;
        setLaunchingIds(prev => new Set(prev).add(id));
        try {
            const msg = await invoke<string>('open_codex_terminal', { id });
            setPushToast({ type: 'success', text: msg || `Đã mở Codex cho ${name}` });
        } catch (e) {
            setPushToast({ type: 'error', text: `Không mở được ${name}: ${String(e)}` });
        } finally {
            setLaunchingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            setTimeout(() => setPushToast(null), 4000);
        }
    };

    // 点 🔄 徽章：开弹窗并拉取该号所有可用重置次数（含各自到期时间）
    const openResetModal = async (id: string, name: string, credits: number | null) => {
        if (resetting) return;
        const version = ++resetQueryVersion.current;
        setResetModal({ id, name, credits });
        setResetList(null);
        setResetListError(null);
        setResetListLoading(true);
        try {
            const items = await invoke<ResetCreditItem[]>('list_reset_credits', { id });
            if (version !== resetQueryVersion.current) return;
            setResetList(items);
        } catch (e) {
            if (version !== resetQueryVersion.current) return;
            setResetListError(humanizeRefreshError(String(e)));
        } finally {
            if (version === resetQueryVersion.current) setResetListLoading(false);
        }
    };

    const closeResetModal = () => {
        if (resetting) return;
        resetQueryVersion.current++;
        setResetModal(null);
        setResetList(null);
        setResetListError(null);
    };

    // 消耗完成后无条件关弹窗（绕过 resetting 守卫，因为此刻 resetting 还为 true）
    const closeResetModalForce = () => {
        setResetModal(null);
        setResetList(null);
        setResetListError(null);
    };

    const handleConsumeReset = async () => {
        if (!resetModal || resetting || resetListLoading || resetListError || !resetList?.length) return;
        const { id, name } = resetModal;
        // 记下当前列表，成功后用 consumed_credit_id 反查「烧掉的是哪条」
        const listSnapshot = resetList;
        setResetting(true);
        try {
            const res = await invoke<ResetCreditResult>('consume_reset_credit', { id });
            closeResetModalForce();
            let text = `${name}：${res.message}`;
            if (res.ok && res.consumed_credit_id && listSnapshot) {
                const burned = listSnapshot.find(c => c.id === res.consumed_credit_id);
                if (burned?.expires_at) {
                    text = `${name}：${res.message}（消耗了到期 ${fmtExpiry(burned.expires_at)} 的那条）`;
                }
            }
            setPushToast({ type: res.ok ? 'success' : 'error', text });
            // 重置成功(或 nothing_to_reset)后重拉一次 quota，刷新限额条 + 剩余次数
            if (res.ok || res.code === 'nothing_to_reset') {
                await handleRefreshOne(id);
            }
        } catch (e) {
            closeResetModalForce();
            setPushToast({ type: 'error', text: `${name} 重置失败：${humanizeRefreshError(String(e))}` });
        } finally {
            setResetting(false);
            setTimeout(() => setPushToast(null), 5000);
        }
    };

    const openInvite = (id: string, name: string) => setInviteModal({ id, name });

    // 初始化数据
    useEffect(() => {
        const initialUsage: Record<string, UsageData> = {};
        const initialInvalids = new Set<string>();
        const initialBanned = new Set<string>();
        const initialRelayUsage: Record<string, RelayUsageCache> = {};

        accounts.forEach(acc => {
            if (acc.is_banned) {
                initialBanned.add(acc.id);
                initialInvalids.add(acc.id);
            } else if (acc.is_token_invalid || acc.is_logged_out) {
                initialInvalids.add(acc.id);
            }
            if (acc.relay_usage_cache) {
                initialRelayUsage[acc.id] = acc.relay_usage_cache;
            }
            if (acc.cached_quota) {
                const isValid = acc.cached_quota.is_valid_for_cli !== false;
                initialUsage[acc.id] = {
                    five_hour_left: acc.cached_quota.five_hour_left,
                    five_hour_reset: acc.cached_quota.five_hour_reset,
                    five_hour_reset_at: acc.cached_quota.five_hour_reset_at,
                    primary_window_seconds: acc.cached_quota.primary_window_seconds,
                    five_hour_label: acc.cached_quota.five_hour_label || 'Hạn mức 5 giờ',
                    weekly_left: acc.cached_quota.weekly_left,
                    weekly_reset: acc.cached_quota.weekly_reset,
                    weekly_reset_at: acc.cached_quota.weekly_reset_at,
                    secondary_window_seconds: acc.cached_quota.secondary_window_seconds,
                    weekly_label: acc.cached_quota.weekly_label || 'Hạn mức tuần',
                    plan_type: acc.cached_quota.plan_type,
                    is_valid_for_cli: isValid,
                    reset_credits: acc.cached_quota.reset_credits,
                    spark: acc.cached_quota.spark,
                    luna_reserve: acc.cached_quota.luna_reserve,
                };
                if (!isValid) initialInvalids.add(acc.id);
            }
        });
        setUsageMap(prev => ({ ...prev, ...initialUsage }));
        setRelayUsageMap(prev => ({ ...prev, ...initialRelayUsage }));
        setInvalidIds(initialInvalids);
        setBannedIds(initialBanned);
    }, [accounts]);

    // 自动 reset 后重拉：cached 数据老于 reset_at 时窗口已经重置但缓存还是旧的 0%，
    // 触发一次 refresh。
    // - 冷却 90s：足够让上一轮 invoke 完成且 accounts prop 拿到新 cached_quota；
    //   失败的话 90s 后自动重试，最多 90s/次的开销可以接受
    // - 跳过 refreshingIds 里在飞的，避免叠加
    // - is_token_invalid/banned/logged_out 由 backend 持久化，前端尊重
    const handleRefreshOneRef = useRef<(id: string) => Promise<void>>(async () => {});
    const autoRefreshTsRef = useRef<Map<string, number>>(new Map());
    const refreshingIdsRef = useRef<Set<string>>(new Set());
    refreshingIdsRef.current = refreshingIds;
    useEffect(() => {
        const COOLDOWN_MS = 90 * 1000;
        const AUTO_CONCURRENCY = 4;

        const scan = () => {
            const nowMs = Date.now();
            const stale: string[] = [];
            const reasons: Record<string, string> = {};
            for (const acc of accounts) {
                if (effectiveKind(acc) !== 'chatgpt_oauth') continue;
                if (acc.is_banned || acc.is_token_invalid || acc.is_logged_out) continue;
                const cq = acc.cached_quota;
                if (!cq) continue;
                const updatedAtMs = cq.updated_at ? new Date(cq.updated_at).getTime() : 0;
                const fiveResetMs = (cq.five_hour_reset_at ?? 0) * 1000;
                const weeklyResetMs = (cq.weekly_reset_at ?? 0) * 1000;
                const needs5h = fiveResetMs > 0 && fiveResetMs <= nowMs && updatedAtMs < fiveResetMs;
                const needsWk = weeklyResetMs > 0 && weeklyResetMs <= nowMs && updatedAtMs < weeklyResetMs;
                if (!needs5h && !needsWk) continue;
                if (refreshingIdsRef.current.has(acc.id)) continue;
                const last = autoRefreshTsRef.current.get(acc.id) ?? 0;
                if (nowMs - last < COOLDOWN_MS) continue;
                autoRefreshTsRef.current.set(acc.id, nowMs);
                stale.push(acc.id);
                reasons[acc.id] = needs5h ? '5H' : 'weekly';
            }
            if (stale.length === 0) return;
            console.log(`[AutoRefresh] 触发 ${stale.length} 个账号 reset 后自动刷新:`,
                stale.map(id => `${accounts.find(a => a.id === id)?.name}(${reasons[id]})`).join(', '));
            let cursor = 0;
            const worker = async () => {
                while (cursor < stale.length) {
                    const i = cursor++;
                    await handleRefreshOneRef.current(stale[i]).catch((e) => {
                        console.warn(`[AutoRefresh] ${stale[i]} 刷新失败:`, e);
                    });
                }
            };
            for (let i = 0; i < Math.min(AUTO_CONCURRENCY, stale.length); i++) worker();
        };

        scan();
        const t = setInterval(scan, 30_000);
        return () => clearInterval(t);
    }, [accounts]);

    // 搜索与过滤逻辑
    const filteredAccounts = useMemo(() => {
        let result = searchQuery
            ? accounts.filter(a => a.name.toLowerCase().includes(searchQuery.toLowerCase()))
            : accounts;

        if (filter !== 'all') {
            result = result.filter(a => {
                // Relay 类账号现在按 relay_category 分流
                const isRelay = effectiveKind(a) === 'relay';
                if (filter === 'relay') return isRelay && (a.relay_category ?? 'aggregator') === 'aggregator';
                if (filter === 'coding_plan') return isRelay && a.relay_category === 'coding_plan';
                if (filter === 'third_party') return isRelay && a.relay_category === 'third_party';
                if (isRelay) return false; // 其它 plan 过滤胶囊只看订阅类
                if (filter === 'google') return effectiveKind(a) === 'antigravity_oauth';
                // Sub = 所有 ChatGPT 订阅号（不含 Relay / OpenAI Key）
                if (filter === 'sub') return effectiveKind(a) === 'chatgpt_oauth';
                const type = usageMap[a.id]?.plan_type?.toLowerCase() || '';
                if (filter === 'pro') return type.includes('pro');
                if (filter === 'plus') return type.includes('plus');
                if (filter === 'team') return type.includes('team');
                if (filter === 'free') return type && !type.includes('pro') && !type.includes('plus') && !type.includes('team');
                return true;
            });
        }
        return result;
    }, [accounts, searchQuery, filter, usageMap]);

    const filterCounts = useMemo(() => {
        const counts = { all: accounts.length, sub: 0, google: 0, pro: 0, plus: 0, team: 0, free: 0, relay: 0, coding_plan: 0, third_party: 0 };
        accounts.forEach(a => {
            const kind = effectiveKind(a);
            if (kind === 'relay') {
                const cat = a.relay_category ?? 'aggregator';
                if (cat === 'coding_plan') counts.coding_plan++;
                else if (cat === 'third_party') counts.third_party++;
                else counts.relay++;
                return;
            }
            if (kind === 'antigravity_oauth') {
                counts.google++;
                return;
            }
            // Sub = ChatGPT 订阅类（所有 plan tier 合在一起）
            if (kind === 'chatgpt_oauth') counts.sub++;
            const type = usageMap[a.id]?.plan_type?.toLowerCase() || '';
            if (type.includes('pro')) counts.pro++;
            else if (type.includes('plus')) counts.plus++;
            else if (type.includes('team')) counts.team++;
            else if (type) counts.free++;
        });
        return counts;
    }, [accounts, usageMap]);

    // 辅助工具函数
    const formatDate = (val?: string | Date | null) => {
        if (!val) return '-';
        const d = typeof val === 'string' ? new Date(val) : val;
        return isNaN(d.getTime()) ? '-' : formatViShortDateTime(d);
    };

    const parseDuration = (str?: string) => {
        if (!str || str === '未知' || str === 'N/A') return { text: 'N/A', hours: 999 };
        if (str === '即将重置') return { text: '重置中', hours: 0 };
        const matches = { d: str.match(/(\d+)天/), h: str.match(/(\d+)小时/), m: str.match(/(\d+)分钟/) };
        const d = parseInt(matches.d?.[1] || '0'), h = parseInt(matches.h?.[1] || '0'), m = parseInt(matches.m?.[1] || '0');
        const totalH = d * 24 + h + m / 60;
        const compact = d > 0 ? `${d}天 ${h}时` : h > 0 ? `${h}时 ${m}分` : `${m}分`;
        return { text: compact || 'N/A', hours: totalH };
    };

    const getStatusInfo = (account: Account) => {
        const isCurrent = account.id === currentId;
        const err = account.keepalive?.last_error;
        const isPermanent = err?.toLowerCase().match(/invalidated|expired|invalid_refresh_token|invalid_grant/);

        if (isPermanent) return { text: 'Hết hiệu lực', warn: true };
        if (isCurrent) return { text: 'Đang dùng', warn: false };
        return { text: err ? 'Đang thử lại' : 'Bình thường', warn: !!err };
    };

    const handlePushToServer = async (id: string, name: string) => {
        setPushingIds(prev => new Set(prev).add(id));
        try {
            const r = await invoke<{ ok: boolean; id: string; upserted: string; quota_refreshed?: boolean }>(
                'remote_push_account',
                { id }
            );
            const actionText =
                r.upserted === 'created' ? 'đã thêm mới'
                : r.upserted === 'merged' ? 'đã gộp với email cũ'
                : 'đã cập nhật';
            const quotaText = r.quota_refreshed ? ', đã cập nhật hạn mức' : '';
            setPushToast({ type: 'success', text: `${name}: gửi lên máy chủ thành công (${actionText}${quotaText})` });
        } catch (e) {
            setPushToast({ type: 'error', text: `${name}: không gửi được lên máy chủ: ${e}` });
        } finally {
            setPushingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
            setTimeout(() => setPushToast(null), 4000);
        }
    };

    const handleSwitchAntigravity = async (id: string, name: string) => {
        if (switchingIds.has(id)) return;
        setSwitchingIds(prev => new Set(prev).add(id));
        try {
            await invoke('switch_antigravity_account', { id });
            onRefreshComplete?.();
            setPushToast({ type: 'success', text: `Đã chuyển tài khoản Google sang ${name}` });
        } catch (error) {
            setPushToast({ type: 'error', text: `Không chuyển được tài khoản Google: ${String(error)}` });
        } finally {
            setSwitchingIds(prev => {
                const next = new Set(prev);
                next.delete(id);
                return next;
            });
            setTimeout(() => setPushToast(null), 4000);
        }
    };

    const handleSwitchRelayModel = async (id: string, name: string) => {
        if(switchingIds.has(id))return;
        setSwitchingIds(prev=>new Set(prev).add(id));
        try {
            await invoke('switch_relay_model_account',{id,model:null});
            onRefreshComplete?.();
            setPushToast({type:'success',text:`Đã chọn ${name} cho các model tương ứng (không đổi Codex/Google)`});
        }catch(error){setPushToast({type:'error',text:`Không chuyển được model: ${String(error)}`});}
        finally{setSwitchingIds(prev=>{const next=new Set(prev);next.delete(id);return next;});setTimeout(()=>setPushToast(null),4000);}
    };

    // 把 Tauri/后端原始报错翻译成人能看懂的一句话。
    const humanizeRefreshError = (raw: string): string => {
        const s = raw.toLowerCase();
        if (s.includes('account_banned')) return 'Tài khoản đã bị khóa';
        if (s.includes('token_invalid')) return 'Token hết hiệu lực, cần đăng nhập lại';
        if (s.includes('account_logged_out')) return 'Phiên đã hết hiệu lực; hãy đăng nhập lại';
        if (s.includes('token_refresh_transient')) return 'Làm mới tạm thời thất bại do mạng hoặc dịch vụ';
        if (s.includes('timeout') || s.includes('timed out')) return 'Yêu cầu quá thời gian chờ';
        if (s.includes('网络请求失败') || s.includes('network')) return 'Lỗi mạng; hãy kiểm tra proxy/kết nối';
        if (s.includes('刷新令牌') || s.includes('refresh')) return 'Không làm mới được refresh_token';
        if (s.includes('relay_account')) return 'Hãy cập nhật số dư từ mục Relay';
        if (raw.length > 160) return raw.slice(0, 160) + '…';
        return raw;
    };

    // 交互处理
    const handleRefreshOne = async (id: string) => {
        setRefreshingIds(prev => new Set(prev).add(id));
        const acc = accounts.find(a => a.id === id);
        const accName = acc?.name ?? id;
        try {
            if (acc && effectiveKind(acc) === 'antigravity_oauth') {
                await invoke<Record<string, AntigravityModelQuota>>('refresh_antigravity_quota', { id });
                await onRefreshComplete?.();
                return;
            }
            // Relay 账号走专属 fetcher（不查 OpenAI usage）
            if (acc && effectiveKind(acc) === 'relay') {
                const cache = await invoke<RelayUsageCache>('refresh_relay_usage', { id });
                setRelayUsageMap(prev => ({ ...prev, [id]: cache }));
                onRefreshComplete?.();
                return;
            }
            const cmd = settings.remote_mode === 'client'
                ? 'remote_refresh_account_quota'
                : 'get_quota_by_id';
            const usage = await invoke<UsageData>(cmd, { id });
            setUsageMap(prev => ({ ...prev, [id]: usage }));
            setInvalidIds(prev => {
                const next = new Set(prev);
                usage.is_valid_for_cli ? next.delete(id) : next.add(id);
                return next;
            });
            onRefreshComplete?.();
        } catch (err) {
            const errMsg = String(err);
            // 仍然按错误类型标 UI 状态
            if (errMsg.includes('ACCOUNT_BANNED')) {
                setBannedIds(prev => new Set(prev).add(id));
                setInvalidIds(prev => new Set(prev).add(id));
            } else if (errMsg.includes('TOKEN_INVALID')) {
                setInvalidIds(prev => new Set(prev).add(id));
            }
            // 后端已持久化的需重登状态需要重新读取账号列表，避免只显示 toast。
            if (errMsg.includes('ACCOUNT_LOGGED_OUT')) {
                onRefreshComplete?.();
            }
            // 把错误 tip 出来，不再静默失败
            setPushToast({
                type: 'error',
                text: `${accName}: cập nhật thất bại — ${acc && effectiveKind(acc) === 'antigravity_oauth' ? errMsg : humanizeRefreshError(errMsg)}`,
            });
            setTimeout(() => setPushToast(null), 6000);
        } finally {
            setRefreshingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        }
    };

    // 把最新的 handleRefreshOne 挂到 ref，让上面 reset 后自动刷新的 effect
    // 不必把它放进依赖里反复重建。
    handleRefreshOneRef.current = handleRefreshOne;

    // The local AGY bridge exposes its quota through /v1/usage. Refresh it on
    // first appearance so the Relay row shows real 5H/7D progress bars instead
    // of the empty placeholder; other Relay providers remain manual-refresh.
    useEffect(() => {
        const agy = accounts.filter(acc => effectiveKind(acc) === 'relay'
            && /^(https?:\/\/)?(127\.0\.0\.1|localhost):28100\/v1\/?$/i.test(acc.relay_base_url || '')
            && !relayUsageMap[acc.id]);
        for (const account of agy) void handleRefreshOne(account.id);
        // The dependency is intentionally accounts: relayUsageMap changes as a
        // result of this effect and must not start a second request loop.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accounts]);

    const handleSaveUsageCookie = async () => {
        if (!cookieEditor) return;
        setSavingCookie(true);
        try {
            await invoke('update_relay_usage_cookie', {
                id: cookieEditor.id,
                usageCookie: cookieEditor.value.trim() || null,
            });
            setRelayUsageMap(prev => {
                const next = { ...prev };
                delete next[cookieEditor.id];
                return next;
            });
            const id = cookieEditor.id;
            setCookieEditor(null);
            await handleRefreshOne(id);
        } catch (e) {
            setPushToast({ type: 'error', text: `Không lưu được MiMo Cookie: ${e}` });
            setTimeout(() => setPushToast(null), 4000);
        } finally {
            setSavingCookie(false);
        }
    };

    /// Relay 余额展示：
    /// - unit 是 `%` → 进度条 mini-card（GLM 这种百分比模型）
    /// - 其它（USD/CNY 等金额） → 纯文本 mini-card（unity2 等返回金额的）
    const RelayQuotaItem = ({ account, cache }: { account: Account; cache: RelayUsageCache | undefined }) => {
        const isMiMoRelay = [
            account.relay_usage_preset,
            account.relay_base_url,
            account.relay_homepage,
            account.name,
        ].some(v => (v ?? '').toLowerCase().includes('mimo') || (v ?? '').toLowerCase().includes('xiaomimimo'));
        const canEditCookie = isMiMoRelay;
        const openCookieEditor = () => {
            if (!canEditCookie) return;
            setCookieEditor({
                id: account.id,
                name: account.name,
                value: account.relay_usage_cookie ?? '',
            });
        };
        const editableProps = canEditCookie
            ? {
                role: 'button',
                tabIndex: 0,
                title: 'Nhấn để sửa MiMo Cookie dùng đọc hạn mức',
                onClick: openCookieEditor,
                onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openCookieEditor();
                    }
                },
            }
            : {};
        if (!cache) {
            return (
                <div className="quota-grid" {...editableProps}>
                    <QuotaItem label="Hạn mức token" percentage={undefined} reset={undefined} />
                </div>
            );
        }
        if (cache.windows?.length) return <RelayQuotaWindows cache={cache} onlyGemini={/28100/.test(account.relay_base_url || '')} />;
        const unit = cache.unit ?? '';
        const isPercent = unit === '%' || unit.includes('%');
        if (isPercent) {
            return (
                <div className="quota-grid" {...editableProps}>
                    <QuotaItem
                        label="Hạn mức token"
                        percentage={cache.remaining}
                        reset={cache.next_reset_at ? '' : undefined}
                        resetAt={cache.next_reset_at ?? undefined}
                    />
                </div>
            );
        }
        // 金额型：mini-card 风格但中间是数字+单位
        const tone = cache.is_active ? 'green' : 'red';
        return (
            <div className="quota-grid" {...editableProps}>
                <div className="quota-mini-card">
                    <div className={`quota-mini-bg ${tone}`} style={{ width: '100%' }} />
                    <div className="quota-mini-content">
                        <span className="quota-label">Số dư</span>
                        <span className={`quota-percent ${tone}`}>
                            {cache.remaining.toFixed(2)} {unit}
                        </span>
                    </div>
                </div>
            </div>
        );
    };

    const QuotaItem = ({ label, percentage, reset, resetAt }: { label: string, percentage: number | undefined, reset: string | undefined, resetAt?: number }) => {
        const countdown = useShortCountdown(resetAt);
        if (percentage === undefined) return (
            <div className="quota-mini-card empty">
                <span className="quota-label">{label}</span>
                <span className="quota-empty">{reset || 'Không áp dụng'}</span>
            </div>
        );
        const { text, hours } = parseDuration(reset);
        const displayTime = countdown || text;
        const color = percentage > 50 ? 'green' : percentage > 20 ? 'orange' : 'red';
        const timeColor = hours < 1 ? 'success' : hours < 6 ? 'warning' : 'neutral';

        return (
            <div className="quota-mini-card">
                <div className={`quota-mini-bg ${color}`} style={{ width: `${percentage}%` }} />
                <div className="quota-mini-content">
                    <span className="quota-label">{label}</span>
                    <div className={`quota-time ${timeColor}`}>
                        <Clock className="icon-tiny" />
                        <span>{displayTime}</span>
                    </div>
                    <span className={`quota-percent ${color}`}>{Math.round(percentage)}%</span>
                </div>
            </div>
        );
    };

    return (
        <div className="account-list-container">
            <div className="account-list-toolbar">
                <div className="search-box">
                    <span className="search-icon">🔍</span>
                    <input type="text" placeholder="Tìm theo email..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} />
                </div>
                <div className="filter-group">
                    {(['all', 'sub', 'google', 'pro', 'plus', 'team', 'free', 'relay', 'coding_plan', 'third_party'] as const).map(t => {
                        const isRelayLike = t === 'relay' || t === 'coding_plan' || t === 'third_party';
                        const isSubGroup = t === 'sub';
                        const label = t === 'all' ? 'Tất cả'
                            : t === 'sub' ? 'Gói đăng ký'
                            : t === 'google' ? 'Google'
                            : t === 'coding_plan' ? 'Plan'
                            : t === 'third_party' ? 'Bên thứ ba'
                            : t === 'relay' ? 'Relay'
                            : t.toUpperCase();
                        return (
                            <button
                                key={t}
                                className={`filter-btn filter-btn-compact ${isRelayLike ? 'filter-btn--relay' : ''} ${isSubGroup ? 'filter-btn--sub' : ''} ${filter === t ? 'active' : ''}`}
                                onClick={() => setFilter(t)}
                            >
                                {label}<span className="filter-count">{filterCounts[t]}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="toolbar-spacer" />
                <button
                    className="toolbar-icon-btn"
                    onClick={warmupAll}
                    disabled={warmingAll}
                    title="Kích hoạt cửa sổ hạn mức cho tất cả tài khoản đăng ký"
                >
                    <Play size={16} className={warmingAll ? 'spinning' : ''} />
                </button>
                <button
                    className={`toolbar-icon-btn ${isMacOS && autoReload ? 'active-reload' : ''}`}
                    onClick={() => setAutoReload(!autoReload)}
                    disabled={!isMacOS}
                    aria-pressed={isMacOS && autoReload}
                    title={!isMacOS ? 'Tự tải lại IDE chỉ hỗ trợ macOS' : autoReload ? 'Tắt tự tải lại IDE' : 'Bật tự tải lại IDE'}
                >
                    <Zap size={16} fill={isMacOS && autoReload ? "currentColor" : "none"} />
                </button>
                {onAddAccount && (
                    <button
                        className="toolbar-icon-btn toolbar-icon-btn-primary"
                        onClick={onAddAccount}
                        title="Đăng nhập tài khoản OpenAI/Google hoặc nhập dữ liệu"
                    >
                        <Plus size={16} />
                    </button>
                )}
                {onAddRelay && (
                    <button
                        className="toolbar-icon-btn toolbar-icon-btn-relay"
                        onClick={onAddRelay}
                        title="Thêm Relay, Coding Plan hoặc Responses API"
                    >
                        <Plus size={16} />
                    </button>
                )}
                {onRefreshUsage && (
                    <button
                        className="toolbar-icon-btn toolbar-icon-btn-accent"
                        onClick={onRefreshUsage}
                        disabled={usageLoading}
                        title="Cập nhật hạn mức tài khoản Codex đang dùng"
                    >
                        <Gauge className={usageLoading ? 'spinning' : ''} size={16} />
                    </button>
                )}
                <button className="btn-refresh" title="Cập nhật hạn mức trong danh sách" aria-label="Cập nhật hạn mức trong danh sách" disabled={isRefreshingAll} onClick={() => {
                    // 之前是 Promise.all 一把梭 — N 个账号同时打 OpenAI usage，
                    // 一旦边缘节流单个账号要 10s+，整批的尾延迟会跟着慢账号走。
                    // 改成并发上限 6 的滑动窗口：快账号先回，慢账号自然排队，
                    // 既不雷霆万钧也不串行。
                    const CONCURRENCY = 6;
                    const ids = filteredAccounts.map(a => a.id);
                    setIsRefreshingAll(true);
                    let cursor = 0;
                    const worker = async () => {
                        while (cursor < ids.length) {
                            const i = cursor++;
                            await handleRefreshOne(ids[i]);
                        }
                    };
                    const workers = Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker);
                    Promise.all(workers).finally(() => setIsRefreshingAll(false));
                }}>
                    <RefreshCw className={isRefreshingAll ? 'spinning' : ''} size={16} />
                </button>
            </div>

            <div className="account-table-scroll">
                <div className="account-table-header">
                    <div className="col-checkbox">
                        <input type="checkbox" className="custom-checkbox" checked={filteredAccounts.length > 0 && filteredAccounts.every(a => selectedIds.has(a.id))} onChange={() => { const s = new Set(selectedIds); filteredAccounts.every(a => s.has(a.id)) ? filteredAccounts.forEach(a => s.delete(a.id)) : filteredAccounts.forEach(a => s.add(a.id)); setSelectedIds(s); }} />
                    </div>
                    <div className="col-drag"></div>
                    <div className="col-email">Tài khoản</div>
                    <div className="col-quota-merged">Hạn mức còn lại</div>
                    <div className="col-time">Trạng thái gói</div>
                    <div className="col-actions">Thao tác</div>
                </div>

                <div className="account-table-body">
                    {filteredAccounts.map(acc => {
                        const usage = usageMap[acc.id];
                        const quotaWindows = quotaWindowView(usage);
                        const kind = effectiveKind(acc);
                        // 被限流 = 任一额度桶（5H / 周 / Spark）剩余为 0，上游已 429 拒绝请求。
                        // 这一刻消耗一次主动重置回收最大（把 0% 的窗口拉回满）。
                        const rateLimited = !!usage && (
                            (quotaWindows.hasFiveHour && quotaWindows.fiveHourLeft === 0) ||
                            (quotaWindows.hasWeekly && quotaWindows.weeklyLeft === 0) ||
                            (!!usage.spark && (usage.spark.five_hour_left === 0 || usage.spark.weekly_left === 0))
                        );
                        const isCurrent = acc.id === currentId;
                        const relayCurrent = relayCurrentState(acc,settings.current_relay_accounts);
                        const isModelRelay = relayCurrent.models.length>0;
                        const isAntigravityCurrent = kind === 'antigravity_oauth'
                            && settings.current_antigravity_account_id === acc.id;
                        const status = isAntigravityCurrent
                            ? { text: 'Google 当前', warn: false }
                            : relayCurrent.isCurrent ? {text:relayCurrent.label,warn:false} : getStatusInfo(acc);
                        const err = acc.keepalive?.last_error;
                        const isPermanentError = err?.toLowerCase().match(/invalidated|expired|invalid_refresh_token|invalid_grant/);
                        const isInvalid = invalidIds.has(acc.id) || !!isPermanentError || acc.is_token_invalid || acc.is_logged_out;
                        const isBanned = bannedIds.has(acc.id);
                        const isLoggedOut = acc.is_logged_out;
                        const isRefreshing = refreshingIds.has(acc.id);
                        const expiry = accountExpiryInfo(acc.account_expires_at);
                        const priming = acc.window_priming;
                        const primeMode = primingWindowKind(acc);
                        const primingEnabled = priming?.configured
                            ? (primeMode === 'weekly'
                                ? priming?.weekly_enabled
                                : priming?.five_hour_enabled)
                            : true;
                        const primingLabel = primeMode === 'weekly' ? '7D' : '5H';

                        return (
                            <div key={acc.id} className={`account-row ${isCurrent || isAntigravityCurrent || relayCurrent.isCurrent ? 'current' : ''} ${selectedIds.has(acc.id) ? 'selected' : ''} ${isBanned ? 'banned' : isLoggedOut ? 'logged-out' : isInvalid ? 'expired' : ''}`}>
                                <div className="col-checkbox">
                                    <input type="checkbox" className="custom-checkbox" checked={selectedIds.has(acc.id)} onChange={() => { const s = new Set(selectedIds); s.has(acc.id) ? s.delete(acc.id) : s.add(acc.id); setSelectedIds(s); }} />
                                </div>
                                <div className="col-drag"><span className="drag-handle">⋮⋮</span></div>
                                <div className="col-email" title="Nhấn để sao chép tên tài khoản">
                                    {(() => {
                                        const isRelay = effectiveKind(acc) === 'relay';
                                        const isMiMoRelay = [
                                            acc.relay_usage_preset,
                                            acc.relay_base_url,
                                            acc.relay_homepage,
                                            acc.name,
                                        ].some(v => (v ?? '').toLowerCase().includes('mimo') || (v ?? '').toLowerCase().includes('xiaomimimo'));
                                        const link = isRelay
                                            ? (isMiMoRelay
                                                ? 'https://platform.xiaomimimo.com/console/plan-manage'
                                                : (acc.relay_homepage || acc.relay_base_url || ''))
                                            : '';
                                        const onNameClick = (e: React.MouseEvent) => {
                                            // Relay：点击账号名打开主页/base_url；其它：复制
                                            if (isRelay && link) {
                                                e.stopPropagation();
                                                openUrl(link).catch((err) => {
                                                    console.error('openUrl failed:', err);
                                                });
                                            } else {
                                                handleCopy(acc.id, acc.name);
                                            }
                                        };
                                        return (
                                            <span
                                                className={isRelay ? 'email-text relay-name-link' : 'email-text'}
                                                onClick={onNameClick}
                                                title={isRelay && link ? `Mở ${link}` : undefined}
                                            >
                                                {maskedIds.has(acc.id) ? '••••••••@••••' : acc.name}
                                            </span>
                                        );
                                    })()}
                                    <button
                                        type="button"
                                        className="account-mask-btn"
                                        onClick={event => { event.stopPropagation(); void toggleMasked(acc.id); }}
                                        title={maskedIds.has(acc.id) ? 'Hiện tên tài khoản' : 'Ẩn tên tài khoản'}
                                        aria-label={maskedIds.has(acc.id) ? 'Hiện tên tài khoản' : 'Ẩn tên tài khoản'}
                                    >
                                        {maskedIds.has(acc.id) ? <Eye size={13} /> : <EyeOff size={13} />}
                                    </button>
                                    <div className="badges" style={{ display: 'flex', gap: '4px', marginLeft: '8px', flexWrap: 'wrap' }}>
                                        {(() => {
                                            const k = effectiveKind(acc);
                                            if (k === 'antigravity_oauth' && isAntigravityCurrent) return null;
                                            const meta = k === 'relay' ? relayCategoryBadge(acc) : KIND_BADGE[k];
                                            return <span className={meta.className}>{meta.label}</span>;
                                        })()}
                                        {copiedId === acc.id && <span className="badge copy-success">Đã sao chép</span>}
                                        {isCurrent && !isModelRelay && <span className="badge current">Đang dùng</span>}
                                        {kind !== 'antigravity_oauth' && (
                                            <label
                                                className={`priority-editor ${savingPriorityIds.has(acc.id) ? 'saving' : ''}`}
                                                title="Mức ưu tiên 1-100; số nhỏ hơn được chọn trước"
                                                onClick={event => event.stopPropagation()}
                                            >
                                                <span>Ưu tiên</span>
                                                <input
                                                    key={`${acc.id}-${acc.priority ?? 50}`}
                                                    type="number"
                                                    min={1}
                                                    max={100}
                                                    defaultValue={acc.priority ?? 50}
                                                    disabled={savingPriorityIds.has(acc.id)}
                                                    onBlur={event => void savePriority(acc.id, event.currentTarget.value)}
                                                    onKeyDown={event => {
                                                        if (event.key === 'Enter') event.currentTarget.blur();
                                                    }}
                                                />
                                            </label>
                                        )}
                                        {relayCurrent.isCurrent && <span className="badge current" title={`当前模型：${relayCurrent.active.join('、')}`}>{relayCurrent.label}</span>}
                                        {isAntigravityCurrent && <span className="badge current">Google đang dùng</span>}
                                        {kind === 'antigravity_oauth' && (() => {
                                            const tier = antigravityTier(acc);
                                            return <span className={tier.className}>{tier.label}</span>;
                                        })()}
                                        {acc.is_session_anchor && (
                                            <span
                                                className="badge anchor"
                                                title="手机锚：磁盘 ~/.codex/auth.json 永远跟随此号，Codex.app 手机远程连接绑定此号；切到其他号时 disk 不动、proxy 出口照切"
                                            >📱 Neo điện thoại</span>
                                        )}
                                        {isBanned ? <span className="badge banned" title="Tài khoản đã bị OpenAI khóa">Bị khóa</span> : isLoggedOut ? <span className="badge logged-out" title="Phiên đăng nhập đã hết hiệu lực">Cần đăng nhập lại</span> : isInvalid && <span className="badge expired" title="Token đã hết hiệu lực">Hết hiệu lực</span>}
                                        {expiry.badge && <span className={`badge account-expiry ${expiry.tone}`} title={expiry.title}>📅 {expiry.badge}</span>}
                                        {usage?.plan_type && <span className="badge plan">{usage.plan_type.toUpperCase()}</span>}
                                        {kind === 'chatgpt_oauth' && usage?.reset_credits == null && (
                                            <button type="button" className="badge reset-credits clickable"
                                                title="Máy chủ chưa trả số lượt reset; nhấn để truy vấn chi tiết."
                                                onClick={() => openResetModal(acc.id, acc.name, null)}>
                                                🔄 Chưa rõ số lượt
                                            </button>
                                        )}
                                        {usage?.reset_credits != null && (
                                            usage.reset_credits > 0 ? (
                                                <span
                                                    className={`badge reset-credits clickable${rateLimited ? ' limited' : ''}`}
                                                    title={rateLimited
                                                        ? '⚡ Đang chạm hạn mức; nhấn để xem và dùng một lượt reset'
                                                        : 'Xem các lượt reset còn lại và thời điểm hết hạn'}
                                                    onClick={() => openResetModal(acc.id, acc.name, usage.reset_credits ?? 0)}
                                                    style={{ cursor: 'pointer' }}
                                                >{rateLimited ? '⚡' : ''}🔄 {usage.reset_credits}</span>
                                            ) : (
                                                <span className="badge reset-credits" title="Không còn lượt reset chủ động">🔄 {usage.reset_credits}</span>
                                            )
                                        )}
                                    </div>
                                </div>
                                <div className={`col-quota-merged ${kind === 'antigravity_oauth' ? 'google-quota-column' : ''}`}>
                                    {effectiveKind(acc) === 'relay' ? (
                                        <>{<RelayQuotaItem account={acc} cache={relayUsageMap[acc.id]} />} {/28100/.test(acc.relay_base_url || '') && <AgyRelayModelQuotas cache={relayUsageMap[acc.id]} models={relayCurrent.models} />}</>
                                    ) : effectiveKind(acc) === 'antigravity_oauth' ? (
                                        <AntigravityQuota quotas={antigravityModelQuotas(acc)} />
                                    ) : usage ? (
                                        <div className={`quota-grid ${quotaWindows.weeklyOnly ? 'weekly-only' : ''}`}>
                                            {quotaWindows.hasFiveHour && <QuotaItem
                                                label="HẠN MỨC 5 GIỜ"
                                                percentage={quotaWindows.fiveHourLeft}
                                                reset={quotaWindows.fiveHourReset}
                                                resetAt={quotaWindows.fiveHourResetAt}
                                            />}
                                            {quotaWindows.hasWeekly && <QuotaItem
                                                label={quotaWindows.weeklyOnly ? 'GIỚI HẠN DUY NHẤT · 7 NGÀY' : 'HẠN MỨC TUẦN · 7 NGÀY'}
                                                percentage={quotaWindows.weeklyLeft}
                                                reset={quotaWindows.weeklyReset}
                                                resetAt={quotaWindows.weeklyResetAt}
                                            />}
                                            {!quotaWindows.hasFiveHour && !quotaWindows.hasWeekly && (
                                                <QuotaItem label="HẠN MỨC" percentage={undefined} reset="API chưa trả cửa sổ hạn mức" />
                                            )}
                                        </div>
                                    ) : <span className="quota-empty">Chưa có dữ liệu</span>}
                                </div>
                                <div className="col-time">
                                    <div className="time-item">
                                        <span className="time-label">Trạng thái:</span>
                                        <span className={`time-val ${status.warn ? 'warn' : ''}`}>{status.text}</span>
                                    </div>
                                    <div className="time-item refresh">
                                        <span className="time-label">Cập nhật:</span>
                                        <span className="time-val">{formatDate(kind === 'antigravity_oauth' ? antigravityQuotaUpdatedAt(acc) : acc.cached_quota?.updated_at)}</span>
                                    </div>
                                    <div className="time-item account-expiry-row">
                                        <span className="time-label">Hết hạn gói:</span>
                                        <button
                                            className={`time-val account-expiry-value ${expiry.tone}`}
                                            title={expiry.title}
                                            onClick={() => {
                                                setExpiryError(null);
                                                setExpiryEditor({ id: acc.id, name: acc.name, value: expiryDateInputValue(acc.account_expires_at) });
                                            }}
                                        >{expiry.text}</button>
                                    </div>
                                    {effectiveKind(acc) !== 'relay' && effectiveKind(acc) !== 'antigravity_oauth' && (
                                        <div className="wakeup-row">
                                            <button
                                                className="wakeup-btn"
                                                onClick={() => handleLaunchCodex(acc.id, acc.name)}
                                                disabled={launchingIds.has(acc.id)}
                                                title="Mở Codex riêng cho tài khoản này"
                                            >
                                                {launchingIds.has(acc.id) ? 'Đang mở…' : '🚀 Mở Codex'}
                                            </button>
                                            {effectiveKind(acc) === 'chatgpt_oauth' && (
                                                <button
                                                    className={`wakeup-btn window-prime-btn ${primingEnabled ? 'active' : ''}`}
                                                    onClick={() => {
                                                        setPrimeError(null);
                                                        setPrimeEditor({
                                                            id: acc.id,
                                                            name: acc.name,
                                                            mode: primeMode,
                                                            fiveHour: primeMode === 'five_hour' ? (priming?.configured ? (priming?.five_hour_enabled ?? false) : true) : false,
                                                            weekly: primeMode === 'weekly' ? (priming?.configured ? (priming?.weekly_enabled ?? false) : true) : false,
                                                            lastAttempt: priming?.last_attempt_at,
                                                            lastSuccess: priming?.last_success_at,
                                                            lastError: priming?.last_error,
                                                        });
                                                    }}
                                                    title={priming?.last_error
                                                        ? `Lỗi kích hoạt gần nhất: ${priming.last_error}`
                                                        : 'Tự gửi một yêu cầu Codex tối thiểu khi cửa sổ hạn mức được đặt lại'}
                                                >{primingEnabled ? `🌿 Tự kích hoạt · ${primingLabel}` : `🌿 Đã tắt · ${primingLabel}`}</button>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <div className="col-actions">
                                    <button className="action-btn refresh" onClick={() => handleRefreshOne(acc.id)} disabled={isRefreshing} title={kind === 'antigravity_oauth' ? 'Cập nhật hạn mức model' : 'Cập nhật'}><RefreshCw size={14} className={isRefreshing ? 'spinning' : ''} /></button>
                                    {settings.remote_mode === 'client' && effectiveKind(acc) !== 'antigravity_oauth' && (
                                        <button
                                            className="action-btn push"
                                            onClick={() => handlePushToServer(acc.id, acc.name)}
                                            disabled={pushingIds.has(acc.id)}
                                            title="Gửi lên máy chủ"
                                        >
                                            <UploadCloud size={14} className={pushingIds.has(acc.id) ? 'spinning' : ''} />
                                        </button>
                                    )}
                                    {!isCurrent && !isModelRelay && effectiveKind(acc) !== 'antigravity_oauth' && (
                                        <button className="action-btn switch" onClick={() => onSwitch(acc.id)} disabled={switchingIds.has(acc.id)} title="Chuyển sang"><ArrowLeftRight size={14} /></button>
                                    )}
                                    {isModelRelay && !relayCurrent.allCurrent && <button className="action-btn switch"
                                        onClick={()=>handleSwitchRelayModel(acc.id,acc.name)} disabled={switchingIds.has(acc.id)}
                                        title={`设为这些模型的当前号：${relayCurrent.models.join('、')}（不影响 Codex / Google）`}><ArrowLeftRight size={14}/></button>}
                                    {kind === 'antigravity_oauth' && !isAntigravityCurrent && (
                                        <button
                                            className="action-btn switch"
                                            onClick={() => handleSwitchAntigravity(acc.id, acc.name)}
                                            disabled={switchingIds.has(acc.id)}
                                            title="Chuyển tài khoản Google, không đổi tài khoản Codex"
                                        >
                                            <ArrowLeftRight size={14} />
                                        </button>
                                    )}
                                    {effectiveKind(acc) === 'chatgpt_oauth' && (usage?.plan_type ?? '').toLowerCase() !== 'free' && (
                                        <button className="action-btn invite" onClick={() => openInvite(acc.id, acc.name)} title="Lời mời và phần thưởng ChatGPT Desktop"><UserPlus size={14} /></button>
                                    )}
                                    <button className="action-btn delete" onClick={() => setAccountToDelete({ id: acc.id, name: acc.name })} title="Xóa"><Trash2 size={14} /></button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="account-list-footer">
                <span>
                    {filteredAccounts.length} tài khoản đã lưu · {' '}
                    {filteredAccounts.filter(acc => !acc.is_banned && !acc.is_token_invalid && !acc.is_logged_out).length} khả dụng · {' '}
                    {filteredAccounts.filter(acc => acc.is_token_invalid || acc.is_logged_out).length} cần đăng nhập lại
                </span>
                {selectedIds.size > 0 && <span className="selected-info">Đã chọn {selectedIds.size}</span>}
                {pushToast && (
                    <span className={`push-toast ${pushToast.type}`} style={{ marginLeft: 'auto' }}>
                        {pushToast.text}
                    </span>
                )}
            </div>

            <ConfirmModal
                isOpen={!!accountToDelete}
                title="Xác nhận xóa tài khoản"
                message={<p>Bạn có chắc muốn xóa vĩnh viễn tài khoản <strong>{accountToDelete?.name}</strong>?<br /><br />Không thể hoàn tác. Thông tin đăng nhập cục bộ của tài khoản này cũng sẽ bị xóa.</p>}
                confirmText="Xóa vĩnh viễn"
                danger
                onConfirm={() => {
                    if (accountToDelete) {
                        onDelete(accountToDelete.id);
                        setAccountToDelete(null);
                    }
                }}
                onCancel={() => setAccountToDelete(null)}
            />

            {expiryEditor && (
                <div className="modal-overlay" onClick={() => !savingExpiry && setExpiryEditor(null)}>
                    <div className="modal-content account-expiry-modal" onClick={e => e.stopPropagation()}>
                        <div className="account-expiry-modal-header">
                            <div>
                                <h2>Ngày hết hạn gói</h2>
                                <p>{expiryEditor.name}</p>
                            </div>
                            <button className="close-btn" onClick={() => setExpiryEditor(null)} disabled={savingExpiry}>×</button>
                        </div>
                        <div className="account-expiry-modal-body">
                            <label htmlFor="account-expiry-date">Ngày hết hạn</label>
                            <input
                                id="account-expiry-date"
                                type="date"
                                value={expiryEditor.value}
                                onChange={e => setExpiryEditor({ ...expiryEditor, value: e.target.value })}
                                disabled={savingExpiry}
                            />
                            <p className="account-expiry-help">Switcher tự đọc ngày hết hạn gói từ thông tin đăng ký trong ID token của OpenAI mỗi lần đăng nhập hoặc làm mới tài khoản. Bạn vẫn có thể nhập tay khi nhà cung cấp không trả dữ liệu. Ngày này không phải thời điểm đặt lại hạn mức.</p>
                            {expiryError && <p className="account-expiry-error">{expiryError}</p>}
                        </div>
                        <div className="account-expiry-modal-actions">
                            <button
                                className="secondary-btn"
                                onClick={() => setExpiryEditor({ ...expiryEditor, value: '' })}
                                disabled={savingExpiry || !expiryEditor.value}
                            >Xóa ngày</button>
                            <div className="account-expiry-modal-actions-right">
                                <button className="secondary-btn" onClick={() => setExpiryEditor(null)} disabled={savingExpiry}>Hủy</button>
                                <button className="primary-btn" onClick={saveAccountExpiry} disabled={savingExpiry}>
                                    {savingExpiry ? 'Đang lưu…' : 'Lưu'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {primeEditor && (
                <div className="modal-overlay" onClick={() => !savingPrime && setPrimeEditor(null)}>
                    <div className="modal-content account-expiry-modal window-prime-modal" onClick={e => e.stopPropagation()}>
                        <div className="account-expiry-modal-header">
                            <div>
                                <h2>Tự kích hoạt chu kỳ</h2>
                                <p>{primeEditor.name}</p>
                            </div>
                            <button className="close-btn" onClick={() => setPrimeEditor(null)} disabled={savingPrime}>×</button>
                        </div>
                        <div className="account-expiry-modal-body window-prime-options">
                            {primeEditor.mode === 'five_hour' ? (
                                <label className="window-prime-option">
                                    <input
                                        type="checkbox"
                                        checked={primeEditor.fiveHour}
                                        onChange={e => setPrimeEditor({ ...primeEditor, fiveHour: e.target.checked })}
                                        disabled={savingPrime}
                                    />
                                    <span><strong>Cửa sổ 5 giờ từ API</strong><small>Tự nhận biết theo thời lượng thật của primary_window</small></span>
                                </label>
                            ) : (
                                <label className="window-prime-option">
                                    <input
                                        type="checkbox"
                                        checked={primeEditor.weekly}
                                        onChange={e => setPrimeEditor({ ...primeEditor, weekly: e.target.checked })}
                                        disabled={savingPrime}
                                    />
                                    <span><strong>Cửa sổ 7 ngày từ API</strong><small>Tự nhận biết theo thời lượng thật của primary_window</small></span>
                                </label>
                            )}
                            <p className="account-expiry-help">Mặc định Switcher tự quản lý mọi tài khoản đăng ký và dùng thời lượng thật của <code>primary_window</code> để nhận biết cửa sổ 5 giờ hoặc 7 ngày. Mỗi mốc đặt lại chỉ gửi một yêu cầu rất nhỏ; chế độ máy khách chỉ để máy chủ thực hiện nhằm tránh gửi trùng.</p>
                            {(primeEditor.lastAttempt || primeEditor.lastSuccess || primeEditor.lastError) && (
                                <div className="window-prime-status">
                                    {primeEditor.lastAttempt && <span>Lần thử gần nhất: {formatViDateTime(primeEditor.lastAttempt)}</span>}
                                    {primeEditor.lastSuccess && <span className="ok">Thành công gần nhất: {formatViDateTime(primeEditor.lastSuccess)}</span>}
                                    {primeEditor.lastError && <span className="err">Kết quả gần nhất: {primeEditor.lastError}</span>}
                                </div>
                            )}
                            {primeError && <p className="account-expiry-error">{primeError}</p>}
                        </div>
                        <div className="account-expiry-modal-actions">
                            <span></span>
                            <div className="account-expiry-modal-actions-right">
                                <button className="secondary-btn" onClick={() => void warmupOne(primeEditor.id, primeEditor.name)} disabled={savingPrime || warmingIds.has(primeEditor.id)}>
                                    {warmingIds.has(primeEditor.id) ? 'Đang kích hoạt…' : 'Kích hoạt ngay'}
                                </button>
                                <button className="secondary-btn" onClick={() => setPrimeEditor(null)} disabled={savingPrime}>Hủy</button>
                                <button className="primary-btn" onClick={saveWindowPriming} disabled={savingPrime}>
                                    {savingPrime ? 'Đang lưu…' : 'Lưu'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {resetModal && (
                <div className="modal-overlay" onClick={closeResetModal}>
                    <div className="modal-content reset-credit-modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="header-top">
                                <h2>Reset chủ động · {resetModal.name}</h2>
                                <button className="close-btn" onClick={closeResetModal} disabled={resetting}>×</button>
                            </div>
                        </div>
                        <div className="modal-body">
                            {resetListLoading ? (
                                <p className="modal-tip">Đang tải chi tiết các lượt reset…</p>
                            ) : resetListError ? (
                                <p className="modal-tip err" role="alert">Không tải được chi tiết: {resetListError}<br />Chưa xác định được số lượt còn lại; hãy thử lại sau.</p>
                            ) : resetList && resetList.length > 0 ? (
                                <>
                                    <p className="modal-tip" style={{ marginBottom: 10 }}>
                                        Có <strong>{resetList.length}</strong> lượt, sắp theo thời điểm hết hạn. Các lượt có giá trị như nhau; máy chủ quyết định lượt nào được dùng, thường là lượt hết hạn sớm nhất.
                                    </p>
                                    <ul className="reset-credit-list">
                                        {resetList.map((c, i) => {
                                            const dl = daysLeft(c.expires_at);
                                            const urgency = dl == null ? '' : dl < 3 ? 'urgent' : dl < 7 ? 'warn' : '';
                                            return (
                                                <li key={c.id} className={`reset-credit-row ${urgency}`}>
                                                    <span className="rc-mark">{i === 0 ? '▸' : ''}</span>
                                                    <span className="rc-expiry">{fmtExpiry(c.expires_at)}</span>
                                                    <span className="rc-days">{dl == null ? '' : `Còn ${dl} ngày`}</span>
                                                    <span className="rc-source">{c.source}</span>
                                                    {i === 0 && <span className="rc-badge">Sẽ được dùng trước</span>}
                                                </li>
                                            );
                                        })}
                                    </ul>
                                    <p className="modal-tip" style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
                                        Dùng một lượt sẽ đặt lại cửa sổ 5 giờ/tuần đã cạn. Không thể hoàn tác. Nếu chưa chạm giới hạn, máy chủ sẽ từ chối và <strong>không trừ lượt</strong>.
                                    </p>
                                </>
                            ) : (
                                <p className="modal-tip">Tài khoản này không còn lượt reset chủ động.</p>
                            )}
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-ghost" onClick={closeResetModal} disabled={resetting}>Hủy</button>
                            <button type="button" className="btn btn-ghost"
                                onClick={() => openResetModal(resetModal.id, resetModal.name, resetModal.credits)}
                                disabled={resetting || resetListLoading}>Tải lại</button>
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleConsumeReset}
                                disabled={resetting || resetListLoading || !!resetListError || !resetList?.length}
                            >
                                {resetting ? 'Đang reset…' : 'Reset ngay'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {cookieEditor && (
                <div className="modal-overlay" onClick={() => !savingCookie && setCookieEditor(null)}>
                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="header-top">
                                <h2>Sửa MiMo Cookie dùng đọc hạn mức</h2>
                                <button className="close-btn" onClick={() => setCookieEditor(null)} disabled={savingCookie}>
                                    ×
                                </button>
                            </div>
                        </div>
                        <div className="modal-body">
                            <p className="modal-tip" style={{ marginBottom: 12 }}>
                                Tài khoản: {cookieEditor.name}. Sau khi đăng nhập <code>platform.xiaomimimo.com</code>, hãy sao chép header <code>Cookie:</code> trong Network.
                            </p>
                            <textarea
                                value={cookieEditor.value}
                                onChange={e => setCookieEditor(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                rows={5}
                                placeholder="Cookie: api-platform_serviceToken=...; userId=...; api-platform_ph=..."
                                style={{ fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, width: '100%' }}
                                disabled={savingCookie}
                            />
                        </div>
                        <div className="modal-footer">
                            <button type="button" className="btn btn-ghost" onClick={() => setCookieEditor(null)} disabled={savingCookie}>
                                Hủy
                            </button>
                            <button type="button" className="btn btn-primary" onClick={handleSaveUsageCookie} disabled={savingCookie}>
                                {savingCookie ? 'Đang lưu…' : 'Lưu và cập nhật'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {inviteModal && <ReferralInviteModal key={inviteModal.id} {...inviteModal} onClose={() => setInviteModal(null)} />}
        </div>
    );
}

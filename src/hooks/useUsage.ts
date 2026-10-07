import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Account, LunaReserveWindow, RelayUsageCache } from './useAccounts';

export interface UsageDisplay {
    plan_type: string;
    five_hour_used: number;
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    five_hour_label: string;
    primary_window_seconds?: number | null;
    weekly_used: number;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
    weekly_label: string;
    secondary_window_seconds?: number | null;
    credits_balance: number | null;
    has_credits: boolean;
    reset_credits?: number | null;
    spark?: SparkWindows | null;
    luna_reserve?: LunaReserveWindow | null;
    is_valid_for_cli: boolean;
}

export interface SparkWindows {
    five_hour_left: number;
    five_hour_reset: string;
    five_hour_reset_at?: number;
    weekly_left: number;
    weekly_reset: string;
    weekly_reset_at?: number;
}

function friendlyUsageError(error: unknown): string {
    const raw = String(error);
    const lower = raw.toLowerCase();
    if (lower.includes('401') || lower.includes('403')) {
        return 'Không thể cập nhật hạn mức vì phiên đăng nhập đã cũ. Hãy gửi một yêu cầu Codex hoặc đăng nhập lại tài khoản này.';
    }
    if (lower.includes('429') || lower.includes('rate limit')) {
        return 'Dịch vụ hạn mức đang bận. Switcher sẽ thử lại tự động; dữ liệu gần nhất vẫn được giữ nguyên.';
    }
    if (lower.includes('timeout') || lower.includes('timed out')) {
        return 'Cập nhật hạn mức quá lâu. Hãy kiểm tra mạng rồi thử lại.';
    }
    return raw
        .replace('未设置当前账号', 'Chưa chọn tài khoản hiện tại')
        .replace('额度查询失败', 'Không thể cập nhật hạn mức')
        .replace('当前激活账号', 'Tài khoản hiện tại');
}

/// Relay (中转账号) 没有 OpenAI 5h+周窗口模型，把 GLM 这类返回的百分比剩余值
/// 映射到 UsageDisplay.five_hour_left，UsageCard 复用同一个进度条渲染。
function relayCacheToUsage(cache: RelayUsageCache, planLabel: string): UsageDisplay {
    const isPercent = (cache.unit ?? '').includes('%');
    const remaining = Number.isFinite(cache.remaining) ? cache.remaining : 0;
    return {
        plan_type: planLabel || 'relay',
        five_hour_used: isPercent ? Math.max(0, 100 - remaining) : 0,
        five_hour_left: isPercent ? remaining : 0,
        five_hour_reset: '',
        five_hour_reset_at: cache.next_reset_at ?? undefined,
        five_hour_label: 'Hạn mức Relay',
        primary_window_seconds: 0,
        weekly_used: 0,
        weekly_left: 0,
        weekly_reset: '',
        weekly_reset_at: undefined,
        weekly_label: 'Không áp dụng',
        secondary_window_seconds: null,
        // 金额型 Relay：把 remaining 直接当 credits 显示
        credits_balance: isPercent ? null : remaining,
        has_credits: !isPercent,
        is_valid_for_cli: cache.is_active,
    };
}

export function useUsage() {
    const [usage, setUsage] = useState<UsageDisplay | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchUsage = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const currentId = await invoke<string | null>('get_current_account_id');
            if (!currentId) {
                setError('Chưa chọn tài khoản hiện tại');
                return;
            }
            // Relay 账号：走专属 fetcher（GLM /api/monitor/usage/quota/limit 等），
            // 不调 OpenAI usage（那条会返回 RELAY_ACCOUNT 错误）。
            const accounts = await invoke<Account[]>('get_accounts');
            const acc = accounts.find(a => a.id === currentId);
            const isRelay = (acc?.kind ?? '').toLowerCase() === 'relay';
            if (isRelay) {
                const cache = await invoke<RelayUsageCache>('refresh_relay_usage', { id: currentId });
                const label = (acc?.relay_homepage ? 'Relay' : 'GLM');
                setUsage(relayCacheToUsage(cache, label));
                return;
            }
            const data = await invoke<UsageDisplay>('get_quota_by_id', { id: currentId });
            setUsage(data);
        } catch (err) {
            setError(friendlyUsageError(err));
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchUsage();
    }, [fetchUsage]);

    // Phần trăm phải lấy lại từ API; thời gian reset được đếm ngược từng giây ở UI.
    // Poll 60 giây khi cửa sổ đang hiển thị để dữ liệu không bị “đóng băng”.
    useEffect(() => {
        const timer = window.setInterval(() => {
            if (document.visibilityState === 'visible') void fetchUsage();
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [fetchUsage]);

    useEffect(() => {
        const unlisten = listen('accounts-updated', () => {
            fetchUsage();
        });
        return () => {
            unlisten.then(fn => fn());
        };
    }, [fetchUsage]);

    return {
        usage,
        loading,
        error,
        refresh: fetchUsage,
    };
}

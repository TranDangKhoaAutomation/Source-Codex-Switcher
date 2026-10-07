import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
    ResponsiveContainer, Legend, AreaChart, Area,
} from 'recharts';
import './CachePanel.css';
import { formatViShortDateTime } from '../utils/dateFormat';

interface TokenHistoryEntry {
    timestamp: string;
    model: string;
    input_tokens: number;
    cached_input_tokens?: number;
    output_tokens: number;
    cost: number;
    cost_saved_usd?: number;
    account_id?: string;
}

interface SessionBinding {
    session_key: string;
    account_id: string;
    age_secs: number;
    hit_count: number;
    total_cached_tokens: number;
}

interface AccountInfo {
    id: string;
    name: string;
}

const COLORS = {
    cached: '#10b981',     // green
    uncached: '#f59e0b',   // orange
    output: '#8b5cf6',     // violet
};

function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
}

function formatUsd(n: number): string {
    if (n < 0.001) return '$' + n.toFixed(5);
    if (n < 1) return '$' + n.toFixed(3);
    return '$' + n.toFixed(2);
}

function formatPct(numer: number, denom: number): string {
    if (denom === 0) return '—';
    return ((numer / denom) * 100).toFixed(1) + '%';
}

function formatAge(secs: number): string {
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h${Math.floor((secs % 3600) / 60)}m`;
}

interface Props {
    accounts: AccountInfo[];
}

const UNKNOWN_LABEL = '(Dữ liệu cũ, không có tài khoản)';

export default function CachePanel({ accounts }: Props) {
    const [history, setHistory] = useState<TokenHistoryEntry[]>([]);
    const [bindings, setBindings] = useState<SessionBinding[]>([]);
    const [loading, setLoading] = useState(true);
    const [days, setDays] = useState(7);
    // 早期没记 account_id 的旧条目默认隐藏；切到 false 看全量
    const [hideUnknown, setHideUnknown] = useState(true);

    const refresh = async () => {
        try {
            const [h, b] = await Promise.all([
                invoke<TokenHistoryEntry[]>('get_token_history', { days }),
                invoke<SessionBinding[]>('get_session_bindings'),
            ]);
            setHistory(h);
            setBindings(b);
        } catch (e) {
            console.error('Cache panel load error:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        refresh();
        const t = setInterval(refresh, 5000);
        return () => clearInterval(t);
    }, [days]);

    const accountNameById = useMemo(() => {
        const m: Record<string, string> = {};
        for (const a of accounts) m[a.id] = a.name;
        return m;
    }, [accounts]);

    // 应用"隐藏旧数据"过滤
    const filteredHistory = useMemo(
        () => (hideUnknown ? history.filter(e => !!e.account_id) : history),
        [history, hideUnknown]
    );

    // 隐藏的条数（让用户知道开关有意义）
    const hiddenCount = useMemo(
        () => history.filter(e => !e.account_id).length,
        [history]
    );

    // 全局统计
    const totals = useMemo(() => {
        let req = 0, input = 0, cached = 0, output = 0, cost = 0, saved = 0;
        for (const e of filteredHistory) {
            req += 1;
            input += e.input_tokens;
            cached += e.cached_input_tokens || 0;
            output += e.output_tokens;
            cost += e.cost;
            saved += e.cost_saved_usd || 0;
        }
        return { req, input, cached, output, cost, saved };
    }, [filteredHistory]);

    // 按账号聚合
    const perAccount = useMemo(() => {
        const m: Record<string, {
            id: string;
            name: string;
            isUnknown: boolean;
            requests: number;
            input: number;
            cached: number;
            output: number;
            cost: number;
            saved: number;
        }> = {};
        for (const e of filteredHistory) {
            const isUnknown = !e.account_id;
            const id = e.account_id || '__unknown__';
            const name = isUnknown
                ? UNKNOWN_LABEL
                : (accountNameById[id] || id);
            if (!m[id]) m[id] = { id, name, isUnknown, requests: 0, input: 0, cached: 0, output: 0, cost: 0, saved: 0 };
            const r = m[id];
            r.requests += 1;
            r.input += e.input_tokens;
            r.cached += e.cached_input_tokens || 0;
            r.output += e.output_tokens;
            r.cost += e.cost;
            r.saved += e.cost_saved_usd || 0;
        }
        // unknown 永远沉到最底
        return Object.values(m).sort((a, b) => {
            if (a.isUnknown && !b.isUnknown) return 1;
            if (!a.isUnknown && b.isUnknown) return -1;
            return b.requests - a.requests;
        });
    }, [filteredHistory, accountNameById]);

    // 按模型聚合（用于 bar chart：uncached / cached / output 三色）
    const perModel = useMemo(() => {
        const m: Record<string, {
            model: string;
            uncachedInput: number;
            cached: number;
            output: number;
        }> = {};
        for (const e of filteredHistory) {
            const k = e.model || 'unknown';
            if (!m[k]) m[k] = { model: k, uncachedInput: 0, cached: 0, output: 0 };
            const c = e.cached_input_tokens || 0;
            m[k].uncachedInput += Math.max(0, e.input_tokens - c);
            m[k].cached += c;
            m[k].output += e.output_tokens;
        }
        return Object.values(m).sort(
            (a, b) => (b.uncachedInput + b.cached + b.output) - (a.uncachedInput + a.cached + a.output)
        );
    }, [filteredHistory]);

    // 时间序列：按天/小时聚合 cache 命中率
    const timeSeries = useMemo(() => {
        // 简单按小时桶
        const buckets: Record<string, { ts: number; input: number; cached: number; saved: number }> = {};
        for (const e of filteredHistory) {
            const t = new Date(e.timestamp);
            t.setMinutes(0, 0, 0);
            const key = t.toISOString();
            if (!buckets[key]) buckets[key] = { ts: t.getTime(), input: 0, cached: 0, saved: 0 };
            buckets[key].input += e.input_tokens;
            buckets[key].cached += e.cached_input_tokens || 0;
            buckets[key].saved += e.cost_saved_usd || 0;
        }
        return Object.values(buckets)
            .sort((a, b) => a.ts - b.ts)
            .map(b => ({
                label: formatViShortDateTime(b.ts),
                hitRate: b.input > 0 ? (b.cached / b.input) * 100 : 0,
                saved: b.saved,
            }));
    }, [filteredHistory]);

    if (loading) {
        return <div className="cache-panel"><div className="cache-loading">Đang tải dữ liệu…</div></div>;
    }

    const hitRate = totals.input > 0 ? (totals.cached / totals.input) * 100 : 0;

    return (
        <div className="cache-panel">
            <div className="cache-header">
                <h2>Prompt Cache</h2>
                <div className="cache-controls">
                    <select value={days} onChange={e => setDays(Number(e.target.value))}>
                        <option value={1}>Trong 24 giờ</option>
                        <option value={7}>Trong 7 ngày</option>
                        <option value={30}>Trong 30 ngày</option>
                        <option value={90}>Trong 90 ngày</option>
                    </select>
                    <label className="cache-toggle" title="Ẩn các bản ghi cũ chưa lưu account_id">
                        <input
                            type="checkbox"
                            checked={hideUnknown}
                            onChange={e => setHideUnknown(e.target.checked)}
                        />
                        <span>Ẩn dữ liệu cũ{hiddenCount > 0 ? ` (${hiddenCount})` : ''}</span>
                    </label>
                    <button onClick={refresh}>Cập nhật</button>
                </div>
            </div>

            {/* KPI 行 */}
            <div className="cache-kpi-row">
                <div className="kpi-tile kpi-green">
                    <div className="kpi-label">Tỷ lệ cache hit</div>
                    <div className="kpi-value">{hitRate.toFixed(1)}%</div>
                    <div className="kpi-sub">cached / input</div>
                </div>
                <div className="kpi-tile kpi-blue">
                    <div className="kpi-label">Chi phí tiết kiệm</div>
                    <div className="kpi-value">{formatUsd(totals.saved)}</div>
                    <div className="kpi-sub">so với input không cache</div>
                </div>
                <div className="kpi-tile kpi-purple">
                    <div className="kpi-label">Tổng chi phí</div>
                    <div className="kpi-value">{formatUsd(totals.cost)}</div>
                    <div className="kpi-sub">{totals.req} yêu cầu</div>
                </div>
                <div className="kpi-tile kpi-orange">
                    <div className="kpi-label">Session đang được giữ</div>
                    <div className="kpi-value">{bindings.length}</div>
                    <div className="kpi-sub">evidence-based</div>
                </div>
            </div>

            {/* 时间序列：命中率 */}
            <div className="cache-card">
                <div className="cache-card-title">Tỷ lệ cache hit theo giờ</div>
                {timeSeries.length === 0 ? (
                    <div className="cache-empty">Chưa có dữ liệu</div>
                ) : (
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={timeSeries}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--chart-axis)" />
                            <YAxis tick={{ fontSize: 11 }} stroke="var(--chart-axis)" tickFormatter={(v) => `${v.toFixed(0)}%`} domain={[0, 100]} />
                            <Tooltip
                                formatter={(v: any, name: any) => name === 'hitRate' ? `${(+v).toFixed(1)}%` : v}
                                contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8, boxShadow: 'var(--chart-tooltip-shadow)', color: 'var(--text-primary)' }}
                            />
                            <Area type="monotone" dataKey="hitRate" stroke={COLORS.cached} fill={COLORS.cached} fillOpacity={0.3} />
                        </AreaChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* 按模型 bar chart */}
            <div className="cache-card">
                <div className="cache-card-title">Token theo model (cached, uncached và output)</div>
                {perModel.length === 0 ? (
                    <div className="cache-empty">Chưa có dữ liệu</div>
                ) : (
                    <ResponsiveContainer width="100%" height={260}>
                        <BarChart data={perModel}>
                            <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid)" />
                            <XAxis dataKey="model" tick={{ fontSize: 11 }} stroke="var(--chart-axis)" />
                            <YAxis tick={{ fontSize: 11 }} stroke="var(--chart-axis)" tickFormatter={formatTokens} />
                            <Tooltip
                                formatter={(v: any) => formatTokens(+v)}
                                contentStyle={{ background: 'var(--chart-tooltip-bg)', border: '1px solid var(--chart-tooltip-border)', borderRadius: 8, boxShadow: 'var(--chart-tooltip-shadow)', color: 'var(--text-primary)' }}
                            />
                            <Legend wrapperStyle={{ fontSize: 12 }} />
                            <Bar dataKey="cached" stackId="a" fill={COLORS.cached} name="Cached input" />
                            <Bar dataKey="uncachedInput" stackId="a" fill={COLORS.uncached} name="Uncached input" />
                            <Bar dataKey="output" stackId="a" fill={COLORS.output} name="Output" />
                        </BarChart>
                    </ResponsiveContainer>
                )}
            </div>

            {/* 按账号表格 */}
            <div className="cache-card">
                <div className="cache-card-title">Theo tài khoản</div>
                {perAccount.length === 0 ? (
                    <div className="cache-empty">Chưa có dữ liệu</div>
                ) : (
                    <table className="cache-table">
                        <thead>
                            <tr>
                                <th>Tài khoản</th>
                                <th>Yêu cầu</th>
                                <th>Input</th>
                                <th>Cached</th>
                                <th>Cache hit</th>
                                <th>Output</th>
                                <th>Chi phí</th>
                                <th>Tiết kiệm</th>
                            </tr>
                        </thead>
                        <tbody>
                            {perAccount.map(a => (
                                <tr key={a.id} className={a.isUnknown ? 'cache-row-unknown' : ''}>
                                    <td className="cache-table-name" title={a.isUnknown ? 'Bản ghi cũ không có account_id nên không thể xác định lại tài khoản' : a.id}>{a.name}</td>
                                    <td>{a.requests}</td>
                                    <td>{formatTokens(a.input)}</td>
                                    <td className="cache-cached">{formatTokens(a.cached)}</td>
                                    <td>{formatPct(a.cached, a.input)}</td>
                                    <td>{formatTokens(a.output)}</td>
                                    <td>{formatUsd(a.cost)}</td>
                                    <td className="cache-saved">{formatUsd(a.saved)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {/* Session 绑定表 */}
            <div className="cache-card">
                <div className="cache-card-title">Session đang được giữ theo cache</div>
                {bindings.length === 0 ? (
                    <div className="cache-empty">Chưa có session nào dùng lại cache</div>
                ) : (
                    <table className="cache-table">
                        <thead>
                            <tr>
                                <th>Session Key</th>
                                <th>Tài khoản</th>
                                <th>Số lần cache hit</th>
                                <th>Tổng cached token</th>
                                <th>Thời gian giữ</th>
                            </tr>
                        </thead>
                        <tbody>
                            {bindings
                                .slice()
                                .sort((a, b) => b.hit_count - a.hit_count)
                                .map(b => (
                                    <tr key={b.session_key}>
                                        <td className="cache-table-key" title={b.session_key}>
                                            {b.session_key.length > 32
                                                ? b.session_key.slice(0, 32) + '…'
                                                : b.session_key}
                                        </td>
                                        <td className="cache-table-name" title={b.account_id}>
                                            {accountNameById[b.account_id] || b.account_id}
                                        </td>
                                        <td>{b.hit_count}</td>
                                        <td>{formatTokens(b.total_cached_tokens)}</td>
                                        <td>{formatAge(b.age_secs)}</td>
                                    </tr>
                                ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

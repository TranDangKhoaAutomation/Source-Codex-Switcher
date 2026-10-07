import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
    AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
    XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';
import './Stats.css';
import { formatViDayMonth, formatViShortDateTime } from '../utils/dateFormat';

interface TokenHistoryEntry {
    timestamp: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    cost: number;
}

interface SwitchEvent {
    timestamp: string;
    from_account: string | null;
    to_account: string;
    reason: string;
    from_quota_5h: number | null;
    to_quota_5h: number | null;
}

interface SwitchStats {
    today_count: number;
    week_count: number;
    total_count: number;
    by_reason: Record<string, number>;
    by_account: Record<string, number>;
}

interface TokenStats {
    total_input_tokens: number;
    total_output_tokens: number;
    total_tokens: number;
    total_cost_usd: number;
    total_requests: number;
}

interface PlanCapacityEstimate {
    plan_type: string;
    window_type: '5h' | 'week';
    sample_count: number;
    avg_capacity: number;
    median_capacity: number;
    min_capacity: number;
    max_capacity: number;
}

interface SessionInCycle {
    session_key: string;
    total_tokens: number;
    turn_count: number;
    first_seen_at: number;
    last_seen_at: number;
}

interface CycleDetail {
    window_start: number;
    window_end: number;
    is_current: boolean;
    total_tokens: number;
    input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    turn_count: number;
    sessions: SessionInCycle[];
    estimated_capacity: number | null;
    estimate_used_pct: number | null;
    hit_limit: boolean;
    last_switch_reason: string | null;
}

interface AccountTokenHistory {
    account_id: string;
    email: string;
    plan_type: string;
    is_current: boolean;
    is_banned: boolean;
    is_token_invalid: boolean;
    current_5h: CycleDetail | null;
    last_5h: CycleDetail | null;
    current_week: CycleDetail | null;
    last_week: CycleDetail | null;
    cycles_5h: CycleDetail[];
    cycles_week: CycleDetail[];
}

interface ProfileAccount {
    id: string;
    name: string;
    kind?: string;
}

interface AccountProfileStats {
    account_id: string;
    available: boolean;
    stats_as_of: string | null;
    summary: {
        lifetime_tokens: number | null;
        peak_daily_tokens: number | null;
        longest_task_seconds: number | null;
        current_streak_days: number | null;
        longest_streak_days: number | null;
    };
    activity: {
        fast_mode_percent: number | null;
        reasoning_effort: string | null;
        reasoning_effort_percent: number | null;
        skills_explored: number | null;
        total_skills_used: number | null;
        total_threads: number | null;
    };
    daily: { date: string; tokens: number }[];
    top_invocations: { kind: string; display_name: string; usage_count: number }[];
    error: string | null;
}

const COLORS = ['#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#ec4899', '#14b8a6', '#f97316'];

function formatTokens(n: number): string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
    if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
    return n.toString();
}

function formatTime(ts: string): string {
    return formatViShortDateTime(ts);
}

function formatDuration(from: string, to: string): string {
    const diff = new Date(to).getTime() - new Date(from).getTime();
    if (diff < 0) return '-';
    const mins = Math.floor(diff / 60000);
    const hours = Math.floor(mins / 60);
    if (hours > 0) return `${hours}h ${mins % 60}m`;
    return `${mins}m`;
}

type TimeRange = 'day' | 'week' | 'month';

function ProfileMetric({ label, value }: { label: string; value: string }) {
    return <div className="profile-metric"><strong>{value}</strong><span>{label}</span></div>;
}

export function Stats() {
    const [range, setRange] = useState<TimeRange>('week');
    const [tokenHistory, setTokenHistory] = useState<TokenHistoryEntry[]>([]);
    const [switchHistory, setSwitchHistory] = useState<SwitchEvent[]>([]);
    const [switchStats, setSwitchStats] = useState<SwitchStats | null>(null);
    const [tokenStats, setTokenStats] = useState<TokenStats | null>(null);
    const [planCaps, setPlanCaps] = useState<PlanCapacityEstimate[]>([]);
    const [accountHistory, setAccountHistory] = useState<AccountTokenHistory[]>([]);
    const [expandedAccount, setExpandedAccount] = useState<string | null>(null);
    const [expandedCycle, setExpandedCycle] = useState<string | null>(null);
    const [profileAccounts, setProfileAccounts] = useState<ProfileAccount[]>([]);
    const [profileAccountId, setProfileAccountId] = useState('');
    const [profileStats, setProfileStats] = useState<AccountProfileStats | null>(null);
    const [profileLoading, setProfileLoading] = useState(false);

    useEffect(() => {
        invoke<ProfileAccount[]>('get_accounts').then(items => {
            const supported = items.filter(item => item.kind === 'chatgpt_oauth' || item.kind === 'legacy');
            setProfileAccounts(supported);
            setProfileAccountId(previous => previous || supported[0]?.id || '');
        }).catch(error => console.error('Không tải được danh sách tài khoản:', error));
    }, []);

    const fetchProfileStats = async () => {
        if (!profileAccountId || profileLoading) return;
        setProfileLoading(true);
        try {
            setProfileStats(await invoke<AccountProfileStats>('get_account_usage_stats', { id: profileAccountId }));
        } catch (error) {
            setProfileStats({
                account_id: profileAccountId,
                available: false,
                stats_as_of: null,
                summary: { lifetime_tokens: null, peak_daily_tokens: null, longest_task_seconds: null, current_streak_days: null, longest_streak_days: null },
                activity: { fast_mode_percent: null, reasoning_effort: null, reasoning_effort_percent: null, skills_explored: null, total_skills_used: null, total_threads: null },
                daily: [],
                top_invocations: [],
                error: String(error),
            });
        } finally {
            setProfileLoading(false);
        }
    };

    const days = range === 'day' ? 1 : range === 'week' ? 7 : 30;

    const fetchData = async () => {
        try {
            const [th, sh, ss, ts, pc, ah] = await Promise.all([
                invoke<TokenHistoryEntry[]>('get_token_history', { days }),
                invoke<SwitchEvent[]>('get_switch_history', { days }),
                invoke<SwitchStats>('get_switch_stats'),
                invoke<TokenStats>('get_token_stats'),
                invoke<PlanCapacityEstimate[]>('get_plan_capacity_estimates'),
                invoke<AccountTokenHistory[]>('get_account_token_history'),
            ]);
            setTokenHistory(th);
            setSwitchHistory(sh.reverse());
            setSwitchStats(ss);
            setTokenStats(ts);
            setPlanCaps(pc);
            setAccountHistory(ah);
        } catch (e) {
            console.error('Không tải được dữ liệu thống kê:', e);
        }
    };

    useEffect(() => { fetchData(); }, [range]);

    // 聚合 token 趋势数据（按小时/天）
    const trendData = (() => {
        const buckets: Record<string, { label: string; input: number; output: number; cost: number }> = {};
        for (const entry of tokenHistory) {
            const d = new Date(entry.timestamp);
            const key = range === 'day'
                ? d.toLocaleTimeString('zh-CN', { hour: '2-digit' })
                : formatViDayMonth(d);
            if (!buckets[key]) buckets[key] = { label: key, input: 0, output: 0, cost: 0 };
            buckets[key].input += entry.input_tokens;
            buckets[key].output += entry.output_tokens;
            buckets[key].cost += entry.cost;
        }
        return Object.values(buckets);
    })();

    // 按模型分布（饼图）
    const modelData = (() => {
        const map: Record<string, number> = {};
        for (const entry of tokenHistory) {
            map[entry.model] = (map[entry.model] || 0) + entry.input_tokens + entry.output_tokens;
        }
        return Object.entries(map).map(([name, value]) => ({ name, value }));
    })();

    // 切号原因分布
    const reasonData = switchStats
        ? Object.entries(switchStats.by_reason).map(([name, value]) => ({ name, value }))
        : [];

    const accountCount = switchStats ? Object.keys(switchStats.by_account).length : 0;

    // 分离常规切号与系统后台任务
    const actualSwitches = switchHistory.filter(e => e.reason !== '自动刷新' && e.reason !== '后台保活');
    const systemLogs = switchHistory.filter(e => e.reason === '自动刷新' || e.reason === '后台保活');

    return (
        <div className="stats-page">
            <div className="stats-header">
                <h2>Thống kê</h2>
                <div className="time-range-btns">
                    {(['day', 'week', 'month'] as TimeRange[]).map(r => (
                        <button
                            key={r}
                            className={`range-btn ${range === r ? 'active' : ''}`}
                            onClick={() => setRange(r)}
                        >
                            {r === 'day' ? 'Ngày' : r === 'week' ? 'Tuần' : 'Tháng'}
                        </button>
                    ))}
                </div>
            </div>

            <div className="stats-section profile-stats-section">
                <div className="profile-stats-toolbar">
                    <div>
                        <h3>Thống kê hồ sơ theo tài khoản</h3>
                        <p>Token trọn đời, chuỗi ngày hoạt động, tác vụ dài nhất và skill/plugin dùng nhiều.</p>
                    </div>
                    <div className="profile-stats-actions">
                        <select value={profileAccountId} onChange={event => setProfileAccountId(event.target.value)}>
                            {profileAccounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}
                        </select>
                        <button className="range-btn active" disabled={!profileAccountId || profileLoading} onClick={fetchProfileStats}>
                            {profileLoading ? 'Đang tải…' : 'Tải thống kê'}
                        </button>
                    </div>
                </div>
                {profileStats && !profileStats.available && (
                    <div className="profile-stats-error">{profileStats.error || 'Máy chủ chưa cung cấp thống kê cho tài khoản này.'}</div>
                )}
                {profileStats?.available && (
                    <>
                        <div className="profile-summary-grid">
                            <ProfileMetric label="Token trọn đời" value={formatTokens(profileStats.summary.lifetime_tokens ?? 0)} />
                            <ProfileMetric label="Ngày dùng cao nhất" value={formatTokens(profileStats.summary.peak_daily_tokens ?? 0)} />
                            <ProfileMetric label="Chuỗi hiện tại" value={`${profileStats.summary.current_streak_days ?? 0} ngày`} />
                            <ProfileMetric label="Chuỗi dài nhất" value={`${profileStats.summary.longest_streak_days ?? 0} ngày`} />
                            <ProfileMetric label="Số cuộc trò chuyện" value={String(profileStats.activity.total_threads ?? 0)} />
                            <ProfileMetric label="Skill đã dùng" value={String(profileStats.activity.total_skills_used ?? profileStats.activity.skills_explored ?? 0)} />
                        </div>
                        <div className="profile-detail-grid">
                            <div>
                                <h4>Hoạt động gần đây</h4>
                                {profileStats.daily.length ? (
                                    <ResponsiveContainer width="100%" height={180}>
                                        <BarChart data={profileStats.daily.slice(-30)}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                            <XAxis dataKey="date" hide />
                                            <YAxis tickFormatter={formatTokens} fontSize={10} />
                                            <Tooltip formatter={value => [formatTokens(Number(value)), 'Token']} />
                                            <Bar dataKey="tokens" fill="#6366f1" radius={[3, 3, 0, 0]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : <p className="log-empty">Chưa có dữ liệu theo ngày.</p>}
                            </div>
                            <div>
                                <h4>Skill và plugin dùng nhiều</h4>
                                {profileStats.top_invocations.length ? (
                                    <ol className="profile-invocations">
                                        {profileStats.top_invocations.slice(0, 8).map((item, index) => (
                                            <li key={`${item.kind}-${item.display_name}-${index}`}><span>{item.display_name}</span><strong>{item.usage_count}</strong></li>
                                        ))}
                                    </ol>
                                ) : <p className="log-empty">Chưa có dữ liệu tích hợp.</p>}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* 摘要卡片 */}
            <div className="stats-cards">
                <div className="stat-card purple">
                    <div className="stat-card-value">{formatTokens(tokenStats?.total_tokens ?? 0)}</div>
                    <div className="stat-card-label">Tổng token</div>
                </div>
                <div className="stat-card yellow">
                    <div className="stat-card-value">${(tokenStats?.total_cost_usd ?? 0).toFixed(2)}</div>
                    <div className="stat-card-label">Tổng chi phí</div>
                </div>
                <div className="stat-card green">
                    <div className="stat-card-value">{switchStats?.total_count ?? 0}</div>
                    <div className="stat-card-label">Số lần chuyển</div>
                </div>
                <div className="stat-card blue">
                    <div className="stat-card-value">{accountCount}</div>
                    <div className="stat-card-label">Tài khoản đã dùng</div>
                </div>
            </div>

            {/* Plan 配额上限估算（基于 quota 快照 Δpct） */}
            {planCaps.length > 0 && (() => {
                const allPlans = Array.from(new Set(planCaps.map(p => p.plan_type))).sort();
                return (
                    <div className="stats-section">
                        <h3>Ước tính dung lượng Plan từ biến động phần trăm</h3>
                        <div className="cycle-summary">
                            <div className="cycle-summary-row cycle-summary-header capacity-header">
                                <span>Plan</span>
                                <span className="num">Mẫu 5h</span>
                                <span className="num">Trung vị 5h</span>
                                <span className="num">Trung bình 5h</span>
                                <span className="num">5h min–max</span>
                                <span className="num">Mẫu tuần</span>
                                <span className="num">Trung vị tuần</span>
                                <span className="num">Trung bình tuần</span>
                                <span className="num">Tuần min–max</span>
                            </div>
                            {allPlans.map(plan => {
                                const f = planCaps.find(p => p.plan_type === plan && p.window_type === '5h');
                                const w = planCaps.find(p => p.plan_type === plan && p.window_type === 'week');
                                return (
                                    <div key={plan} className="cycle-summary-row capacity-row">
                                        <span>
                                            <span className={`quota-plan plan-${plan.toLowerCase()}`}>{plan || '—'}</span>
                                        </span>
                                        <span className="num">{f?.sample_count ?? '—'}</span>
                                        <span className="num total">{f ? formatTokens(f.median_capacity) : '—'}</span>
                                        <span className="num">{f ? formatTokens(f.avg_capacity) : '—'}</span>
                                        <span className="num observed">
                                            {f ? `${formatTokens(f.min_capacity)}–${formatTokens(f.max_capacity)}` : '—'}
                                        </span>
                                        <span className="num">{w?.sample_count ?? '—'}</span>
                                        <span className="num total">{w ? formatTokens(w.median_capacity) : '—'}</span>
                                        <span className="num">{w ? formatTokens(w.avg_capacity) : '—'}</span>
                                        <span className="num observed">
                                            {w ? `${formatTokens(w.min_capacity)}–${formatTokens(w.max_capacity)}` : '—'}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="cycle-hint">
                            <b>Cách tính</b>: mỗi lần chuyển tài khoản, Switcher lưu quota vào <code>~/.codex-switcher/quota-snapshots.jsonl</code>. Chênh lệch token và <code>used_pct</code> trong cùng cửa sổ được dùng để ước tính dung lượng Plan.<br/>
                            <b>Trung vị</b> là kết quả ổn định nhất sau khi loại mẫu bất thường. Mẫu có Δpct dưới 3% bị bỏ vì sai số làm tròn quá lớn.<br/>
                            Mẫu tự tích lũy theo thời gian; dưới khoảng 5 mẫu thì kết quả chỉ mang tính tham khảo.
                        </div>
                    </div>
                );
            })()}

            {/* 每号 Token 历史（三级下钻：号 → 周期 → session） */}
            {accountHistory.length > 0 && (
                <div className="stats-section">
                    <h3>Lịch sử token theo tài khoản</h3>
                    <div className="acct-hist-table">
                        <div className="acct-hist-row acct-hist-header">
                            <span></span>
                            <span>Email / Plan</span>
                            <span className="num">5h hiện tại</span>
                            <span className="num">5h trước</span>
                            <span className="num">Tuần hiện tại</span>
                            <span className="num">Tuần trước</span>
                        </div>
                        {accountHistory.map(acc => {
                            const expanded = expandedAccount === acc.account_id;
                            return (
                                <div key={acc.account_id}>
                                    <div
                                        className={`acct-hist-row clickable ${acc.is_current ? 'current' : ''}`}
                                        onClick={() => {
                                            setExpandedAccount(expanded ? null : acc.account_id);
                                            setExpandedCycle(null);
                                        }}
                                    >
                                        <span className="acct-toggle">{expanded ? '▼' : '▶'}</span>
                                        <span className="acct-email" title={acc.email}>
                                            {acc.is_current && <span className="quota-badge current">Đang dùng</span>}
                                            {acc.is_banned && <span className="quota-badge banned">Bị khóa</span>}
                                            {acc.is_token_invalid && <span className="quota-badge invalid">Hết hiệu lực</span>}
                                            <span className={`quota-plan plan-${(acc.plan_type || 'unknown').toLowerCase()}`}>{acc.plan_type || '—'}</span>
                                            <span className="acct-email-text">{acc.email}</span>
                                        </span>
                                        <CellPair cycle={acc.current_5h} />
                                        <CellPair cycle={acc.last_5h} />
                                        <CellPair cycle={acc.current_week} />
                                        <CellPair cycle={acc.last_week} />
                                    </div>
                                    {expanded && (
                                        <div className="acct-hist-expand">
                                            <div className="acct-cycle-header">Chu kỳ 5h ({acc.cycles_5h.length})</div>
                                            <CycleHistoryTable
                                                cycles={acc.cycles_5h}
                                                accountId={acc.account_id}
                                                windowLabel="5h"
                                                expandedCycle={expandedCycle}
                                                setExpandedCycle={setExpandedCycle}
                                            />
                                            <div className="acct-cycle-header">Chu kỳ tuần ({acc.cycles_week.length})</div>
                                            <CycleHistoryTable
                                                cycles={acc.cycles_week}
                                                accountId={acc.account_id}
                                                windowLabel="week"
                                                expandedCycle={expandedCycle}
                                                setExpandedCycle={setExpandedCycle}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    <div className="cycle-hint">
                        Mỗi ô hiển thị <b>token thực tế / dung lượng ước tính</b>.<br/>
                        Token thực tế được cộng chính xác trong cửa sổ, kể cả khi đã chuyển tài khoản nhiều lần. Dung lượng được ước tính từ snapshot có <code>used_pct</code> cao nhất để giảm sai số làm tròn.<br/>
                        🔴 nghĩa là đã chạm hạn mức trong cửa sổ. Nhấn tài khoản để xem từng chu kỳ, rồi nhấn chu kỳ để xem chi tiết session.
                    </div>
                </div>
            )}

            {/* Token 趋势图 */}
            {trendData.length > 0 && (
                <div className="stats-section">
                    <h3>Xu hướng token</h3>
                    <ResponsiveContainer width="100%" height={250}>
                        <AreaChart data={trendData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" fontSize={11} />
                            <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={formatTokens} />
                            <Tooltip
                                contentStyle={{ background: '#1e1245', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                labelStyle={{ color: '#fff' }}
                            />
                            <Area type="monotone" dataKey="input" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.4} name="Input" />
                            <Area type="monotone" dataKey="output" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.4} name="Output" />
                            <Legend />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            )}

            {/* 下半部：费用 + 模型分布 */}
            <div className="stats-grid">
                {trendData.length > 0 && (
                    <div className="stats-section">
                        <h3>Xu hướng chi phí</h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <BarChart data={trendData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="label" stroke="rgba(255,255,255,0.3)" fontSize={11} />
                                <YAxis stroke="rgba(255,255,255,0.3)" fontSize={11} tickFormatter={v => `$${v}`} />
                                <Tooltip
                                    contentStyle={{ background: '#1e1245', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                    formatter={(v) => [`$${Number(v).toFixed(4)}`, 'Chi phí']}
                                />
                                <Bar dataKey="cost" fill="#fbbf24" radius={[4, 4, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                )}

                {(modelData.length > 0 || reasonData.length > 0) && (
                    <div className="stats-section">
                        <h3>{modelData.length > 0 ? 'Phân bố model' : 'Lý do chuyển tài khoản'}</h3>
                        <ResponsiveContainer width="100%" height={200}>
                            <PieChart>
                                <Pie
                                    data={modelData.length > 0 ? modelData : reasonData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={50}
                                    outerRadius={80}
                                    paddingAngle={3}
                                    dataKey="value"
                                >
                                    {(modelData.length > 0 ? modelData : reasonData).map((_, i) => (
                                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip
                                    contentStyle={{ background: '#1e1245', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
                                />
                                <Legend />
                            </PieChart>
                        </ResponsiveContainer>
                    </div>
                )}
            </div>

            {/* 切号日志 */}
            <div className="stats-section">
                <h3>Lịch sử chuyển tài khoản ({actualSwitches.length})</h3>
                <div className="switch-log-table">
                    <div className="log-header">
                        <span>Thời gian</span>
                        <span>Luồng chuyển</span>
                        <span>Lý do</span>
                        <span>Thời lượng dùng</span>
                    </div>
                    {actualSwitches.length === 0 ? (
                        <div className="log-empty">Chưa có lần chuyển tài khoản nào.</div>
                    ) : (
                        actualSwitches.map((e, i) => (
                            <div key={i} className="log-row">
                                <span className="log-time">{formatTime(e.timestamp)}</span>
                                <span className="log-path">
                                    {e.from_account ? (
                                        <>{shortName(e.from_account)} → {shortName(e.to_account)}</>
                                    ) : (
                                        <>→ {shortName(e.to_account)}</>
                                    )}
                                </span>
                                <span className={`log-reason ${reasonClass(e.reason)}`}>{e.reason}</span>
                                <span className="log-duration">
                                    {i < actualSwitches.length - 1
                                        ? formatDuration(actualSwitches[i + 1].timestamp, e.timestamp)
                                        : '-'}
                                </span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* 后台任务日志 */}
            {systemLogs.length > 0 && (
                <div className="stats-section">
                    <h3>Nhật ký tác vụ nền ({systemLogs.length})</h3>
                    <div className="switch-log-table">
                        <div className="log-header">
                            <span>Thời gian</span>
                            <span>Tài khoản đích</span>
                            <span>Loại tác vụ</span>
                            <span>Hạn mức sau cập nhật</span>
                        </div>
                        {systemLogs.map((e, i) => (
                            <div key={`sys-${i}`} className="log-row">
                                <span className="log-time">{formatTime(e.timestamp)}</span>
                                <span className="log-path">
                                    {shortName(e.to_account)}
                                </span>
                                <span className={`log-reason ${reasonClass(e.reason)}`}>{e.reason}</span>
                                <span className="log-duration" style={{ color: 'var(--success-color, #10b981)' }}>
                                    {e.to_quota_5h !== null ? `${e.to_quota_5h}%` : 'Thành công'}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function shortName(name: string): string {
    if (name.length > 18) return name.slice(0, 15) + '...';
    return name;
}

function formatWindow(startSec: number, endSec: number): string {
    const s = new Date(startSec * 1000);
    const e = new Date(endSec * 1000);
    const fmtDate = (d: Date) => formatViDayMonth(d);
    const fmtTime = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (fmtDate(s) === fmtDate(e)) {
        return `${fmtDate(s)} ${fmtTime(s)}-${fmtTime(e)}`;
    }
    return `${fmtDate(s)} ${fmtTime(s)} → ${fmtDate(e)} ${fmtTime(e)}`;
}

/// 顶层一格：「实测累加 / 估算上限」
/// null 也用 cell-pair 双行结构，保证上下与有数据的格子严格对齐。
function CellPair({ cycle }: { cycle: CycleDetail | null }) {
    if (!cycle) {
        return (
            <span className="num cell-pair cell-empty">
                <span className="cell-actual">—</span>
                <span className="cell-est">&nbsp;</span>
            </span>
        );
    }
    const cap = cycle.estimated_capacity;
    const pct = cycle.estimate_used_pct;
    const lowConfidence = pct != null && pct < 10;
    const isFallback = !cycle.is_current;
    return (
        <span className={`num cell-pair ${isFallback ? 'cell-fallback' : ''}`}>
            <span className="cell-actual">
                {cycle.hit_limit && <span className="cell-fire">🔴</span>}
                {formatTokens(cycle.total_tokens)}
            </span>
            <span className="cell-est" title={pct != null ? `quota snapshot used_pct=${pct}% · cửa sổ ${formatWindow(cycle.window_start, cycle.window_end)}` : `Cửa sổ ${formatWindow(cycle.window_start, cycle.window_end)}`}>
                {isFallback && <span className="cell-fallback-tag">Gần nhất</span>}
                {cap != null
                    ? `~${formatTokens(cap)}${lowConfidence ? '?' : ''}`
                    : (isFallback ? <>&nbsp;</> : ' ')}
            </span>
        </span>
    );
}

/// 周期列表（5h 或周）。点开一行看 session 明细。
function CycleHistoryTable({
    cycles,
    accountId,
    windowLabel,
    expandedCycle,
    setExpandedCycle,
}: {
    cycles: CycleDetail[];
    accountId: string;
    windowLabel: '5h' | 'week';
    expandedCycle: string | null;
    setExpandedCycle: (k: string | null) => void;
}) {
    if (cycles.length === 0) {
        return <div className="acct-empty">Không có dữ liệu</div>;
    }
    return (
        <div className="hist-cycle-table">
            <div className="hist-cycle-row hist-cycle-header">
                <span></span>
                <span>Cửa sổ</span>
                <span className="num">Token thực tế</span>
                <span className="num">Dung lượng ước tính</span>
                <span className="num">used_pct</span>
                <span className="num">Số lượt</span>
                <span className="num">Số session</span>
                <span>Trạng thái</span>
            </div>
            {cycles.map(c => {
                const key = `${accountId}-${windowLabel}-${c.window_end}`;
                const expanded = expandedCycle === key;
                const rowCls = c.is_current
                    ? 'current'
                    : c.hit_limit
                        ? 'limit-hit'
                        : '';
                const statusLabel = c.is_current
                    ? 'Đang diễn ra'
                    : c.hit_limit
                        ? `🔴 ${c.last_switch_reason ?? 'Hạn mức'}`
                        : 'Bình thường';
                return (
                    <div key={key}>
                        <div
                            className={`hist-cycle-row clickable ${rowCls}`}
                            onClick={() => setExpandedCycle(expanded ? null : key)}
                        >
                            <span className="acct-toggle">{expanded ? '▼' : '▶'}</span>
                            <span className="cycle-window">{formatWindow(c.window_start, c.window_end)}</span>
                            <span className="num total">{c.total_tokens.toLocaleString()}</span>
                            <span className="num">
                                {c.estimated_capacity != null ? `~${formatTokens(c.estimated_capacity)}` : '—'}
                            </span>
                            <span className="num">
                                {c.estimate_used_pct != null ? `${c.estimate_used_pct}%` : '—'}
                            </span>
                            <span className="num">{c.turn_count}</span>
                            <span className="num">{c.sessions.length}</span>
                            <span className={c.is_current ? 'cycle-status current' : c.hit_limit ? 'cycle-status limit' : 'cycle-status done'}>
                                {statusLabel}
                            </span>
                        </div>
                        {expanded && (
                            <div className="hist-session-table">
                                <div className="hist-session-row hist-session-header">
                                    <span>Session</span>
                                    <span className="num">Số lượt</span>
                                    <span className="num">Token</span>
                                    <span>Đầu tiên → gần nhất</span>
                                </div>
                                {c.sessions.map((s, idx) => (
                                    <div key={idx} className="hist-session-row">
                                        <span className="cycle-window" title={s.session_key}>{s.session_key.length > 40 ? s.session_key.slice(0, 40) + '…' : s.session_key}</span>
                                        <span className="num">{s.turn_count}</span>
                                        <span className="num total">{s.total_tokens.toLocaleString()}</span>
                                        <span className="cycle-window">
                                            {formatWindow(s.first_seen_at, s.last_seen_at)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
}

function reasonClass(reason: string): string {
    if (reason.includes('手动')) return 'manual';
    if (reason.includes('429') || reason.includes('限额')) return 'ratelimit';
    if (reason.includes('封号')) return 'banned';
    if (reason.includes('保活')) return 'keepalive';
    if (reason.includes('刷新')) return 'refresh';
    return 'auto';
}

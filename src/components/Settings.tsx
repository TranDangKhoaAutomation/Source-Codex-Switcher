import { useState, useEffect, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Palette, Server, Monitor, Wrench, Save, Github, Radio, Smartphone, Search, X } from 'lucide-react';
import { Account, effectiveKind } from '../hooks/useAccounts';
import './Settings.css';
import { isMacOS } from '../platform';

interface AppSettings {
    tray_display_mode: 'icon_and_session' | 'active_usage_text' | 'hidden';
    dock_display_mode: 'show_in_dock' | 'menu_bar_only';
    scheduled_warmup_enabled: boolean;
    scheduled_warmup_times: string[];
    last_scheduled_warmup_key?: string | null;
    start_with_windows: boolean;
    start_minimized: boolean;
    close_to_tray: boolean;
    auto_reload_ide: boolean;
    primary_ide: string;
    use_pkill_restart: boolean;
    background_refresh: boolean;
    refresh_interval_minutes: number;
    inactive_refresh_days: number;
    theme_palette: string;
    allow_auto_switch_to_free: boolean;
    strict_priority_routing: boolean;
    auto_return_to_priority: boolean;
    priority_return_threshold: number;
    proxy_enabled: boolean;
    proxy_port: number;
    proxy_allow_lan: boolean;
    switch_mode: string;
    remote_mode: string;
    remote_server_port: number;
    remote_server_bind: string;
    remote_server_url: string;
    remote_server_url_fallback: string;
    remote_shared_secret: string;
    solo_auto_sync_current: boolean;
    proxy_bootstrap_byte_cap: number;
    proxy_bootstrap_time_cap_ms: number;
    relay_auto_switch_out: boolean;
    relay_auto_switch_in: boolean;
    client_direct_upstream: boolean;
    client_owns_current: boolean;
}

interface RemoteHealth {
    mode: string;
    version: string;
    account_count: number;
}

const IDE_OPTIONS = [
    { value: 'Windsurf', label: 'Windsurf' },
    { value: 'Antigravity', label: 'Antigravity' },
    { value: 'Cursor', label: 'Cursor' },
    { value: 'VSCode', label: 'VS Code' },
    { value: 'Codex', label: 'Codex App' },
];

interface SettingsProps {
    accounts?: Account[];
    onSetSessionAnchor?: (id: string, enabled: boolean) => Promise<void>;
}

export function Settings({ accounts = [], onSetSessionAnchor }: SettingsProps = {}) {
    const [settings, setSettings] = useState<AppSettings>({
        tray_display_mode: 'active_usage_text',
        dock_display_mode: 'show_in_dock',
        scheduled_warmup_enabled: false,
        scheduled_warmup_times: [],
        start_with_windows: false,
        start_minimized: true,
        close_to_tray: true,
        auto_reload_ide: false,
        primary_ide: 'Windsurf',
        use_pkill_restart: false,
        background_refresh: false,
        refresh_interval_minutes: 30,
        inactive_refresh_days: 7,
        theme_palette: 'midnight',
        allow_auto_switch_to_free: false,
        strict_priority_routing: true,
        auto_return_to_priority: false,
        priority_return_threshold: 95,
        proxy_enabled: false,
        proxy_port: 18080,
        proxy_allow_lan: false,
        switch_mode: 'auto',
        remote_mode: 'off',
        remote_server_port: 18081,
        remote_server_bind: '0.0.0.0',
        remote_server_url: '',
        remote_server_url_fallback: '',
        remote_shared_secret: '',
        solo_auto_sync_current: true,
        proxy_bootstrap_byte_cap: 32 * 1024,
        proxy_bootstrap_time_cap_ms: 8000,
        relay_auto_switch_out: true,
        relay_auto_switch_in: false,
        client_direct_upstream: false,
        client_owns_current: false,
    });
    const [saving, setSaving] = useState(false);
    const [repairing, setRepairing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [remoteBusy, setRemoteBusy] = useState(false);
    const [remoteStatus, setRemoteStatus] = useState<string>('');
    const [showAnchorPicker, setShowAnchorPicker] = useState(false);
    const [anchorSearch, setAnchorSearch] = useState('');
    const [anchorBusy, setAnchorBusy] = useState(false);

    // 手机锚只对 ChatGPT 订阅号有效：Codex.app `/codex/remote/control/*`
    // 必须用 chatgpt_account_id 鉴权；Relay / OpenAI API key 没有这个 claim。
    const anchorAccount = useMemo(
        () => accounts.find(a => a.is_session_anchor) || null,
        [accounts]
    );
    const anchorCandidates = useMemo(
        () => accounts.filter(a => effectiveKind(a) === 'chatgpt_oauth'),
        [accounts]
    );
    const filteredAnchorCandidates = useMemo(() => {
        const q = anchorSearch.trim().toLowerCase();
        if (!q) return anchorCandidates;
        return anchorCandidates.filter(a => {
            const plan = (a.cached_quota?.plan_type || '').toLowerCase();
            return a.name.toLowerCase().includes(q) || plan.includes(q);
        });
    }, [anchorCandidates, anchorSearch]);

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const data = await invoke<AppSettings>('get_settings');
            setSettings(data);
        } catch (e) {
            console.error('加载设置失败:', e);
        }
    };

    const saveSettings = async () => {
        setSaving(true);
        setMessage(null);
        try {
            await invoke('update_settings', { settings });
            setMessage({ type: 'success', text: '✅ Đã lưu cài đặt' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Không thể lưu: ${e}` });
        } finally {
            setSaving(false);
        }
    };

    const updateField = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
        setSettings(prev => ({ ...prev, [key]: value }));
    };

    const withRemote = async (label: string, fn: () => Promise<string>) => {
        setRemoteBusy(true);
        setRemoteStatus('');
        setMessage(null);
        try {
            const text = await fn();
            setRemoteStatus(`✅ ${label}：${text}`);
            setMessage({ type: 'success', text: `${label}: thành công` });
        } catch (e) {
            setRemoteStatus(`❌ ${label}: thất bại — ${e}`);
            setMessage({ type: 'error', text: `${label}: thất bại — ${e}` });
        } finally {
            setRemoteBusy(false);
        }
    };

    const handleGenerateSecret = async () => {
        try {
            const s = await invoke<string>('remote_generate_secret');
            updateField('remote_shared_secret', s);
            setMessage({ type: 'success', text: 'Đã tạo khóa mới; hãy lưu cài đặt.' });
        } catch (e) {
            setMessage({ type: 'error', text: `Không thể tạo khóa: ${e}` });
        }
    };

    const handleSoloSyncNow = () =>
        withRemote('Đồng bộ tài khoản hiện tại', async () => {
            const switched = await invoke<string | null>('solo_sync_current');
            return switched ? `Đã chuyển sang ${switched}` : 'Đã khớp với máy chủ, không cần chuyển.';
        });

    const handleRemoteTest = () =>
        withRemote('Kiểm tra kết nối', async () => {
            const [url, h] = await invoke<[string, RemoteHealth]>('remote_probe');
            return `Đang dùng ${url}; máy chủ v${h.version}; ${h.account_count} tài khoản.`;
        });

    const handleRemotePushAll = () =>
        withRemote('Gửi toàn bộ tài khoản lên máy chủ', async () => {
            const n = await invoke<number>('remote_push_all');
            return `Đã gửi ${n} tài khoản.`;
        });

    const handleRemotePullAll = () =>
        withRemote('Nhận toàn bộ tài khoản từ máy chủ', async () => {
            const n = await invoke<number>('remote_pull_all');
            return `Đã hợp nhất ${n} tài khoản.`;
        });

    const handleRemotePullAllTokens = () =>
        withRemote('Đồng bộ toàn bộ token từ máy chủ', async () => {
            const r = await invoke<{
                pulled: number;
                refreshed: number;
                current: string | null;
                current_name: string | null;
                wrote_auth_json: boolean;
                errors: [string, string][];
            }>('remote_pull_all_tokens');
            const parts = [
                `Đã nhận ${r.pulled} tài khoản`,
                `token ${r.refreshed}`,
            ];
            if (r.current_name) parts.push(`current=${r.current_name}`);
            if (r.wrote_auth_json) parts.push('đã cập nhật auth.json');
            if (r.errors.length > 0) parts.push(`${r.errors.length} lỗi`);
            return parts.join(' · ');
        });

    const handleRemoteRestart = () =>
        withRemote('Khởi động lại dịch vụ HTTP', async () => {
            const s = await invoke<string>('remote_restart_server');
            return s;
        });

    const handleBindAnchor = async (id: string) => {
        if (!onSetSessionAnchor) return;
        setAnchorBusy(true);
        setMessage(null);
        try {
            await onSetSessionAnchor(id, true);
            setMessage({ type: 'success', text: '✅ Đã cố định tài khoản cho điện thoại' });
            setTimeout(() => setMessage(null), 3000);
            setShowAnchorPicker(false);
            setAnchorSearch('');
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Không thể cố định tài khoản: ${e}` });
        } finally {
            setAnchorBusy(false);
        }
    };

    const handleUnbindAnchor = async () => {
        if (!onSetSessionAnchor || !anchorAccount) return;
        setAnchorBusy(true);
        setMessage(null);
        try {
            await onSetSessionAnchor(anchorAccount.id, false);
            setMessage({ type: 'success', text: '✅ Đã bỏ tài khoản cố định' });
            setTimeout(() => setMessage(null), 3000);
        } catch (e) {
            setMessage({ type: 'error', text: `❌ Không thể bỏ cố định: ${e}` });
        } finally {
            setAnchorBusy(false);
        }
    };

    const handleRepair = async () => {
        if (!confirm('Thao tác này sẽ thử xóa thuộc tính cách ly bảo mật của Codex trên macOS.\n\nHệ thống có thể yêu cầu mật khẩu quản trị. Bạn có muốn tiếp tục không?')) {
            return;
        }

        setRepairing(true);
        setMessage(null);
        try {
            const ticket = await invoke<string>('request_quarantine_fix_ticket');
            await invoke('fix_codex_quarantine', { ticket });
            alert('✅ Đã sửa xong.\n\nHãy thử mở lại Codex.');
        } catch (e) {
            alert(`❌ Không thể sửa: ${e}`);
        } finally {
            setRepairing(false);
        }
    };


    return (
        <div className="settings-page">
            <div className="settings-header">
                <h2>Cài đặt</h2>
                <button
                    className="save-button"
                    onClick={saveSettings}
                    disabled={saving}
                >
                    <Save size={14} />
                    {saving ? 'Đang lưu...' : 'Lưu cài đặt'}
                </button>
            </div>

            {message && (
                <div className={`settings-message ${message.type}`}>
                    {message.text}
                </div>
            )}

            <div className="settings-section">
                <h3><Palette size={16} /> Giao diện</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Bảng màu</span>
                        <span className="setting-desc">Chọn tông màu dễ nhìn cho toàn bộ ứng dụng.</span>
                    </div>
                    <select
                        className="select-input"
                        value={settings.theme_palette}
                        onChange={e => updateField('theme_palette', e.target.value)}
                    >
                        <option value="midnight">Tối dịu mắt</option>
                        <option value="github">Xanh cổ điển</option>
                        <option value="agate">Xanh ngọc</option>
                    </select>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Hiển thị trong khay hệ thống</span>
                        <span className="setting-desc">Chọn chỉ biểu tượng, hiện hạn mức của tài khoản đang dùng, hoặc ẩn hoàn toàn.</span>
                    </div>
                    <select
                        className="select-input"
                        value={settings.tray_display_mode ?? 'active_usage_text'}
                        onChange={e => updateField('tray_display_mode', e.target.value as AppSettings['tray_display_mode'])}
                    >
                        <option value="icon_and_session">Biểu tượng và phiên hiện tại</option>
                        <option value="active_usage_text">Hiện hạn mức đang dùng</option>
                        <option value="hidden">Ẩn khỏi khay hệ thống</option>
                    </select>
                </div>

                {isMacOS && (
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">Hiển thị trên Dock</span>
                            <span className="setting-desc">Có thể giữ biểu tượng trên Dock hoặc chỉ chạy ở thanh menu.</span>
                        </div>
                        <select
                            className="select-input"
                            value={settings.dock_display_mode ?? 'show_in_dock'}
                            onChange={e => updateField('dock_display_mode', e.target.value as AppSettings['dock_display_mode'])}
                        >
                            <option value="show_in_dock">Hiện trên Dock</option>
                            <option value="menu_bar_only">Chỉ thanh menu</option>
                        </select>
                    </div>
                )}
            </div>

            <div className="settings-section">
                <h3><Monitor size={16} /> Khởi động và chạy nền</h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Khởi động cùng Windows</span>
                        <span className="setting-desc">Tự chạy Codex Switcher sau khi đăng nhập để proxy và chuyển tài khoản luôn sẵn sàng.</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.start_with_windows ?? false}
                            onChange={e => updateField('start_with_windows', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item sub-item">
                    <div className="setting-info">
                        <span className="setting-label">Khởi động ẩn dưới nền</span>
                        <span className="setting-desc">Không mở cửa sổ khi Windows khởi động; ứng dụng vẫn chạy trong khay hệ thống.</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.start_minimized ?? true}
                            disabled={!settings.start_with_windows}
                            onChange={e => updateField('start_minimized', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Đóng cửa sổ nhưng vẫn chạy nền</span>
                        <span className="setting-desc">Bật: nút X chỉ thu ứng dụng xuống khay. Tắt: nút X thoát hẳn và proxy sẽ dừng.</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.close_to_tray ?? true}
                            onChange={e => updateField('close_to_tray', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div className="settings-section">
                <h3><Server size={16} /> Dịch vụ nền</h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Tự làm mới và đồng bộ phiên</span>
                        <span className="setting-desc">
                            {settings.remote_mode === 'client'
                                ? 'Ở chế độ máy khách, máy chủ chịu trách nhiệm làm mới phiên; máy này sẽ không làm mới lần nữa để tránh xung đột token.'
                                : 'Tài khoản đang dùng lấy trạng thái chính thức từ máy chủ; các tài khoản còn lại được làm mới tuần tự sau khi bạn lưu cài đặt.'}
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.remote_mode === 'client' ? false : settings.background_refresh}
                            disabled={settings.remote_mode === 'client'}
                            onChange={e => updateField('background_refresh', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                        <span className={`toggle-text ${settings.background_refresh && settings.remote_mode !== 'client' ? 'on' : ''}`}>
                            {settings.remote_mode === 'client'
                                ? 'Do máy chủ quản lý'
                                : settings.background_refresh ? 'Đang bật' : 'Đang tắt'}
                        </span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Warm-up theo giờ cố định</span>
                        <span className="setting-desc">Gửi yêu cầu tối thiểu cho các tài khoản đăng ký vào giờ đã chọn. Chạy nền ngay cả khi cửa sổ đã đóng; mặc định tắt để không dùng quota ngoài ý muốn.</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.scheduled_warmup_enabled ?? false}
                            onChange={e => updateField('scheduled_warmup_enabled', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {settings.scheduled_warmup_enabled && (
                    <div className="setting-item sub-item">
                        <div className="setting-info">
                            <span className="setting-label">Các mốc giờ mỗi ngày</span>
                            <span className="setting-desc">Nhập theo giờ máy, cách nhau bằng dấu phẩy, ví dụ: 08:00, 13:30, 20:00.</span>
                        </div>
                        <input
                            className="text-input"
                            type="text"
                            value={(settings.scheduled_warmup_times ?? []).join(', ')}
                            onChange={e => updateField('scheduled_warmup_times', e.target.value
                                .split(',')
                                .map(value => value.trim())
                                .filter(value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value)))}
                            placeholder="08:00, 13:30, 20:00"
                        />
                    </div>
                )}

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Cho phép tự chuyển sang tài khoản Free</span>
                        <span className="setting-desc">Khi cần đổi tài khoản, ưu tiên gói trả phí; chỉ dùng tài khoản Free nếu bạn bật lựa chọn này.</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.allow_auto_switch_to_free}
                            onChange={e => updateField('allow_auto_switch_to_free', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Chuyển theo thứ tự ưu tiên tuyệt đối</span>
                        <span className="setting-desc">
                            Khi tài khoản hiện tại hết quota, luôn chọn số ưu tiên nhỏ nhất đang dùng được. Ví dụ: ưu tiên 2 hết thì chọn ưu tiên 1 trước ưu tiên 4, dù ưu tiên 4 còn nhiều quota hơn.
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.strict_priority_routing ?? true}
                            onChange={e => updateField('strict_priority_routing', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Tự quay về tài khoản ưu tiên cao</span>
                        <span className="setting-desc">
                            Khi tài khoản có mức ưu tiên cao hơn hồi đủ hạn mức, tự chuyển về tài khoản đó. Chỉ chuyển theo một chiều lên ưu tiên cao hơn nên không bị nhảy qua lại.
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.auto_return_to_priority ?? false}
                            onChange={e => updateField('auto_return_to_priority', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {settings.auto_return_to_priority && (
                    <div className="setting-item sub-item">
                        <div className="setting-info">
                            <span className="setting-label">Ngưỡng hạn mức để quay về (%)</span>
                            <span className="setting-desc">Tài khoản trả phí dùng giá trị thấp hơn giữa hạn mức 5 giờ và hạn mức tuần.</span>
                        </div>
                        <input
                            type="number"
                            className="number-input"
                            min={1}
                            max={100}
                            value={settings.priority_return_threshold ?? 95}
                            onChange={e => updateField('priority_return_threshold', Math.min(100, Math.max(1, parseInt(e.target.value) || 95)))}
                        />
                    </div>
                )}

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Quay về tài khoản đăng ký khi relay/API gặp lỗi</span>
                        <span className="setting-desc">
                            Khi bật, nếu relay, Coding Plan hoặc API bên thứ ba trả lỗi xác thực/hạn mức, Switcher tự chuyển sang tài khoản đăng ký còn dùng được. Khi tắt, lỗi được trả nguyên về ứng dụng.
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.relay_auto_switch_out ?? true}
                            onChange={e => updateField('relay_auto_switch_out', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Cho phép tự chọn relay, Plan và API bên thứ ba</span>
                        <span className="setting-desc">
                            Mặc định tắt để tránh phát sinh phí ngoài ý muốn. Khi bật, các nguồn này được xếp cùng tài khoản đăng ký trong danh sách tự động chuyển.
                        </span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={settings.relay_auto_switch_in ?? false}
                            onChange={e => updateField('relay_auto_switch_in', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {settings.remote_mode === 'client' && (
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">Cho HTTP kết nối trực tiếp từ máy này</span>
                            <span className="setting-desc">
                                HTTP và WebSocket sẽ cùng đi thẳng từ máy này; máy chủ chỉ cung cấp token. Phù hợp khi đường truyền của máy chủ không ổn định.
                            </span>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.client_direct_upstream ?? false}
                                onChange={e => updateField('client_direct_upstream', e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                )}

                {settings.remote_mode === 'client' && (
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">Máy này tự quản lý tài khoản hiện tại</span>
                            <span className="setting-desc">
                                Máy này tự quyết định tài khoản đang dùng và tự ghi `~/.codex/auth.json`; trạng thái `/current` trên máy chủ sẽ không ghi đè lại.
                            </span>
                        </div>
                        <label className="toggle">
                            <input
                                type="checkbox"
                                checked={settings.client_owns_current ?? false}
                                onChange={e => updateField('client_owns_current', e.target.checked)}
                            />
                            <span className="toggle-slider"></span>
                        </label>
                    </div>
                )}

                {
                    settings.background_refresh && settings.remote_mode !== 'client' && (
                        <>
                            <div className="setting-item sub-item">
                                <div className="setting-info">
                                    <span className="setting-label">Chu kỳ kiểm tra (phút)</span>
                                </div>
                                <input
                                    type="number"
                                    className="number-input"
                                    min={5}
                                    max={120}
                                    value={settings.refresh_interval_minutes}
                                    onChange={e => updateField('refresh_interval_minutes', parseInt(e.target.value) || 30)}
                                />
                            </div>
                            <div className="setting-item sub-item">
                                <div className="setting-info">
                                    <span className="setting-label">Làm mới tài khoản không dùng sau (ngày)</span>
                                    <span className="setting-desc">Chỉ làm mới khi lần cập nhật gần nhất đã cũ hơn số ngày này.</span>
                                </div>
                                <input
                                    type="number"
                                    className="number-input"
                                    min={1}
                                    max={30}
                                    value={settings.inactive_refresh_days}
                                    onChange={e => updateField('inactive_refresh_days', parseInt(e.target.value) || 7)}
                                />
                            </div>
                        </>
                    )
                }
            </div >

            <div className="settings-section">
                <h3><Monitor size={16} /> Tải lại IDE</h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Tự tải lại IDE</span>
                        <span className="setting-desc">{isMacOS ? 'Tải lại IDE sau khi đổi tài khoản để áp dụng token mới.' : 'Tính năng này chỉ hỗ trợ macOS; trên Windows hãy tải lại IDE thủ công.'}</span>
                    </div>
                    <label className="toggle">
                        <input
                            type="checkbox"
                            checked={isMacOS && settings.auto_reload_ide}
                            disabled={!isMacOS}
                            onChange={e => updateField('auto_reload_ide', e.target.checked)}
                        />
                        <span className="toggle-slider"></span>
                    </label>
                </div>

                {isMacOS && settings.auto_reload_ide && (
                    <>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">IDE chính</span>
                                <span className="setting-desc">Chỉ tải lại IDE được chọn.</span>
                            </div>
                            <select
                                className="select-input"
                                value={settings.primary_ide}
                                onChange={e => updateField('primary_ide', e.target.value)}
                            >
                                {IDE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Khởi động lại bằng cách dừng tiến trình</span>
                                <span className="setting-desc">Dùng `pkill` để khởi động lại; phù hợp với Windsurf trên macOS.</span>
                            </div>
                            <label className="toggle">
                                <input
                                    type="checkbox"
                                    checked={settings.use_pkill_restart}
                                    onChange={e => updateField('use_pkill_restart', e.target.checked)}
                                />
                                <span className="toggle-slider"></span>
                            </label>
                        </div>
                    </>
                )}
            </div>

            <div className="settings-section">
                <h3><Radio size={16} /> Chế độ máy chủ trong mạng nội bộ</h3>

                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Chế độ hoạt động</span>
                        <span className="setting-desc">
                            Tắt: chạy độc lập. Máy chủ: cung cấp API cho máy khác. Máy khách: dùng tài khoản và token do máy chủ quản lý.
                        </span>
                    </div>
                    <select
                        className="select-input"
                        value={settings.remote_mode}
                        onChange={e => updateField('remote_mode', e.target.value)}
                    >
                        <option value="off">Tắt (chạy độc lập)</option>
                        <option value="server">Máy chủ</option>
                        <option value="client">Máy khách</option>
                    </select>
                </div>

                {settings.remote_mode === 'server' && (
                    <>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Cổng lắng nghe</span>
                                <span className="setting-desc">Cổng HTTP API của máy chủ, mặc định 18081.</span>
                            </div>
                            <input
                                type="number"
                                className="number-input"
                                min={1024}
                                max={65535}
                                value={settings.remote_server_port}
                                onChange={e => updateField('remote_server_port', parseInt(e.target.value) || 18081)}
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Địa chỉ lắng nghe</span>
                                <span className="setting-desc">`0.0.0.0` lắng nghe mọi card mạng; chỉ nên cho phép mạng ZeroTier truy cập.</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                value={settings.remote_server_bind}
                                onChange={e => updateField('remote_server_bind', e.target.value)}
                                placeholder="0.0.0.0"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Khóa dùng chung</span>
                                <span className="setting-desc">Máy khách phải gửi `X-Auth-Token`; để trống sẽ từ chối mọi yêu cầu.</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                                <input
                                    type="text"
                                    className="text-input"
                                    style={{ minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                                    value={settings.remote_shared_secret}
                                    onChange={e => updateField('remote_shared_secret', e.target.value)}
                                    placeholder="Chưa đặt"
                                />
                                <button
                                    className="action-button"
                                    onClick={handleGenerateSecret}
                                    disabled={remoteBusy}
                                >
                                    Tạo khóa
                                </button>
                            </div>
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Khởi động lại dịch vụ HTTP</span>
                                <span className="setting-desc">Sau khi lưu thay đổi cổng, địa chỉ hoặc khóa, bấm đây để áp dụng.</span>
                            </div>
                            <button
                                className="action-button"
                                onClick={handleRemoteRestart}
                                disabled={remoteBusy}
                            >
                                {remoteBusy ? 'Đang thực hiện...' : 'Khởi động lại ngay'}
                            </button>
                        </div>
                    </>
                )}

                {(settings.remote_mode === 'client' || settings.remote_mode === 'solo') && (
                    <>
                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Địa chỉ API máy chủ chính</span>
                                <span className="setting-desc">Được thử trước; nên dùng IP mạng nội bộ, ví dụ http://192.168.2.14:18081.</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                style={{ minWidth: 260 }}
                                value={settings.remote_server_url}
                                onChange={e => updateField('remote_server_url', e.target.value)}
                                placeholder="http://192.168.2.14:18081"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Địa chỉ API dự phòng</span>
                                <span className="setting-desc">Tự dùng khi địa chỉ chính mất kết nối; có thể nhập IP ZeroTier.</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                style={{ minWidth: 260 }}
                                value={settings.remote_server_url_fallback}
                                onChange={e => updateField('remote_server_url_fallback', e.target.value)}
                                placeholder="http://172.26.96.198:18081"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Khóa dùng chung</span>
                                <span className="setting-desc">Phải trùng với khóa trên máy chủ.</span>
                            </div>
                            <input
                                type="text"
                                className="text-input"
                                style={{ minWidth: 260, fontFamily: 'monospace', fontSize: 12 }}
                                value={settings.remote_shared_secret}
                                onChange={e => updateField('remote_shared_secret', e.target.value)}
                                placeholder="Chưa đặt"
                            />
                        </div>

                        <div className="setting-item sub-item">
                            <div className="setting-info">
                                <span className="setting-label">Đồng bộ dữ liệu</span>
                                <span className="setting-desc">Kiểm tra kết nối, gửi tài khoản lên hoặc nhận dữ liệu từ máy chủ.</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                                <button className="action-button" onClick={handleRemoteTest} disabled={remoteBusy}>
                                    Kiểm tra kết nối
                                </button>
                                <button className="action-button" onClick={handleRemotePushAll} disabled={remoteBusy}>
                                    Gửi tất cả
                                </button>
                                <button className="action-button" onClick={handleRemotePullAll} disabled={remoteBusy}>
                                    Nhận và hợp nhất
                                </button>
                                <button className="action-button" onClick={handleRemotePullAllTokens} disabled={remoteBusy}>
                                    Đồng bộ toàn bộ token
                                </button>
                            </div>
                        </div>

                        {settings.remote_mode === 'solo' && (
                            <>
                                <div className="setting-item sub-item">
                                    <div className="setting-info">
                                        <span className="setting-label">Tự đồng bộ tài khoản hiện tại</span>
                                        <span className="setting-desc">
                                            Mỗi lần kiểm tra, máy này dùng cùng tài khoản hiện tại với máy chủ. Nếu máy chủ mất kết nối, trạng thái trên máy này được giữ nguyên.
                                        </span>
                                    </div>
                                    <label className="toggle">
                                        <input
                                            type="checkbox"
                                            checked={settings.solo_auto_sync_current}
                                            onChange={e => updateField('solo_auto_sync_current', e.target.checked)}
                                        />
                                        <span className="toggle-slider"></span>
                                    </label>
                                </div>

                                <div className="setting-item sub-item">
                                    <div className="setting-info">
                                        <span className="setting-label">Đồng bộ ngay</span>
                                        <span className="setting-desc">Lấy tài khoản hiện tại từ máy chủ và chuyển ngay, kể cả khi tự đồng bộ đang tắt.</span>
                                    </div>
                                    <button
                                        className="action-button"
                                        onClick={handleSoloSyncNow}
                                        disabled={remoteBusy}
                                    >
                                        {remoteBusy ? 'Đang thực hiện...' : 'Đồng bộ ngay'}
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                )}

                {remoteStatus && (
                    <div className="setting-item sub-item">
                        <span className="setting-desc" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {remoteStatus}
                        </span>
                    </div>
                )}
            </div>

            {onSetSessionAnchor && (
                <div className="settings-section">
                    <h3><Smartphone size={16} /> Cố định tài khoản cho Codex trên điện thoại</h3>
                    <div className="setting-item">
                        <div className="setting-info">
                            <span className="setting-label">Tài khoản đang cố định</span>
                            <span className="setting-desc">
                                `~/.codex/auth.json` luôn giữ tài khoản này để kết nối từ điện thoại không bị ngắt. Proxy vẫn có thể chuyển sang tài khoản khác. Chỉ tài khoản đăng ký ChatGPT mới dùng được.
                            </span>
                        </div>
                        <div className="anchor-actions">
                            <span className={`anchor-current ${anchorAccount ? 'bound' : 'unbound'}`}>
                                {anchorAccount ? (
                                    <>
                                        📱 {anchorAccount.name}
                                        <span className={`anchor-current-plan plan-${(anchorAccount.cached_quota?.plan_type || 'unknown').toLowerCase()}`}>
                                            {anchorAccount.cached_quota?.plan_type
                                                ? anchorAccount.cached_quota.plan_type.toUpperCase()
                                                : 'Chưa xác định'}
                                        </span>
                                    </>
                                ) : 'Chưa cố định'}
                            </span>
                            <button
                                className="action-button"
                                onClick={() => { setAnchorSearch(''); setShowAnchorPicker(true); }}
                                disabled={anchorBusy}
                            >
                                {anchorAccount ? 'Đổi tài khoản' : 'Chọn tài khoản'}
                            </button>
                            {anchorAccount && (
                                <button
                                    className="action-button warning"
                                    onClick={handleUnbindAnchor}
                                    disabled={anchorBusy}
                                >
                                    Bỏ cố định
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="settings-section danger">
                <h3><Wrench size={16} /> Khắc phục sự cố</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Sửa lỗi Codex bị thoát đột ngột</span>
                        <span className="setting-desc">Xóa thuộc tính cách ly bảo mật trên macOS; có thể cần quyền quản trị.</span>
                    </div>
                    <button
                        className="action-button warning"
                        onClick={handleRepair}
                        disabled={!isMacOS || repairing}
                        title={!isMacOS ? 'Chỉ áp dụng cho macOS' : undefined}
                    >
                        {repairing ? 'Đang sửa...' : 'Sửa ngay'}
                    </button>
                </div>
            </div>

            {showAnchorPicker && (
                <div className="modal-overlay" onClick={() => !anchorBusy && setShowAnchorPicker(false)}>
                    <div className="anchor-picker" onClick={e => e.stopPropagation()}>
                        <div className="anchor-picker-header">
                            <div>
                                <h3>Chọn tài khoản cố định cho điện thoại</h3>
                                <p className="anchor-picker-hint">
                                    Chỉ tài khoản đăng ký ChatGPT có mã tài khoản cần thiết cho kết nối từ xa.
                                </p>
                            </div>
                            <button
                                className="anchor-picker-close"
                                onClick={() => setShowAnchorPicker(false)}
                                disabled={anchorBusy}
                                title="Đóng"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="anchor-picker-search">
                            <Search size={14} />
                            <input
                                type="text"
                                placeholder="Tìm theo email hoặc gói (Team, Pro, Free)…"
                                value={anchorSearch}
                                onChange={e => setAnchorSearch(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className="anchor-picker-list">
                            {filteredAnchorCandidates.length === 0 ? (
                                <div className="anchor-picker-empty">
                                    {anchorCandidates.length === 0
                                        ? 'Chưa có tài khoản đăng ký ChatGPT'
                                        : 'Không có tài khoản phù hợp'}
                                </div>
                            ) : (
                                filteredAnchorCandidates.map(acc => {
                                    const plan = acc.cached_quota?.plan_type;
                                    const planLabel = plan ? plan.toUpperCase() : 'CHƯA XÁC ĐỊNH';
                                    const planClass = (plan || 'unknown').toLowerCase();
                                    return (
                                        <button
                                            key={acc.id}
                                            className={`anchor-picker-item ${acc.is_session_anchor ? 'current' : ''}`}
                                            onClick={() => handleBindAnchor(acc.id)}
                                            disabled={anchorBusy || acc.is_session_anchor}
                                        >
                                            <span className="anchor-picker-name">{acc.name}</span>
                                            <span className={`anchor-picker-plan plan-${planClass}`}>{planLabel}</span>
                                            {acc.is_session_anchor && (
                                                <span className="anchor-picker-tag">✓ Đang cố định</span>
                                            )}
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    </div>
                </div>
            )}

            <div className="settings-section">
                <h3><Github size={16} /> Giới thiệu</h3>
                <div className="setting-item">
                    <div className="setting-info">
                        <span className="setting-label">Codex Switcher</span>
                        <span className="setting-desc">Tự chuyển nhiều tài khoản, proxy cục bộ và thống kê sử dụng.</span>
                    </div>
                    <a
                        className="action-button github-link"
                        href="https://github.com/TranDangKhoaAutomation/Source-Codex-Switcher"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        <Github size={14} /> GitHub
                    </a>
                </div>
            </div>
        </div >
    );
}

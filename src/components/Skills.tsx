import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import Markdown from 'react-markdown';
import { Check, Link2, LoaderCircle, Unlink } from 'lucide-react';
import './Skills.css';

interface SkillApps {
    codex: boolean;
    claude: boolean;
    gemini: boolean;
    opencode: boolean;
    zcode: boolean;
    grok: boolean;
    kimi: boolean;
    antigravity: boolean;
}

interface InstalledSkill {
    id: string;
    name: string;
    description: string;
    directory: string;
    source: string;
    repo_owner: string | null;
    repo_name: string | null;
    apps: SkillApps;
    installed_at: string;
}

interface DiscoverableSkill {
    key: string;
    name: string;
    description: string;
    directory: string;
    repo_owner: string;
    repo_name: string;
    repo_branch: string;
    installed: boolean;
}

interface SkillRepo {
    owner: string;
    name: string;
    branch: string;
    enabled: boolean;
}

type Tab = 'installed' | 'discover' | 'repos';

const APPS = ['codex', 'claude', 'gemini', 'opencode', 'zcode', 'grok', 'kimi', 'antigravity'] as const;

export function Skills() {
    const [tab, setTab] = useState<Tab>('installed');
    const [installed, setInstalled] = useState<InstalledSkill[]>([]);
    const [discovered, setDiscovered] = useState<DiscoverableSkill[]>([]);
    const [repos, setRepos] = useState<SkillRepo[]>([]);
    const [appStatus, setAppStatus] = useState<Record<string, boolean>>({});
    const [search, setSearch] = useState('');
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [detailSkill, setDetailSkill] = useState<InstalledSkill | null>(null);
    const [detailContent, setDetailContent] = useState<string>('');
    const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
    const [confirmInput, setConfirmInput] = useState('');
    const [remoteMode, setRemoteMode] = useState<string>('off');
    const [syncingServer, setSyncingServer] = useState(false);
    const [linkingApp, setLinkingApp] = useState<string | null>(null);

    // 新仓库表单
    const [newOwner, setNewOwner] = useState('');
    const [newName, setNewName] = useState('');
    const [newBranch, setNewBranch] = useState('main');

    const showMsg = (type: 'success' | 'error', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 5000);
    };

    const loadInstalled = async (rescan = false) => {
        try {
            if (rescan) {
                const count = await invoke<number>('scan_and_import_skills');
                if (count > 0) {
                    showMsg('success', `Đã tự nhập ${count} skill mới`);
                }
            }
            const list = await invoke<InstalledSkill[]>('get_installed_skills');
            setInstalled(list);
        } catch (e) { console.error(e); }
    };

    const loadRepos = async () => {
        try {
            const list = await invoke<SkillRepo[]>('get_skill_repos');
            setRepos(list);
        } catch (e) { console.error(e); }
    };

    const loadAppStatus = async () => {
        try {
            const status = await invoke<Record<string, boolean>>('get_skill_app_status');
            setAppStatus(status);
        } catch (e) { console.error(e); }
    };

    useEffect(() => {
        loadInstalled(true); // 首次加载时扫描补录新 skill
        loadRepos();
        loadAppStatus();
        invoke<any>('get_settings')
            .then(s => setRemoteMode(String(s?.remote_mode || 'off')))
            .catch(() => {});
    }, []);

    const handleDiscover = async () => {
        setLoading(true);
        try {
            const list = await invoke<DiscoverableSkill[]>('discover_skills');
            setDiscovered(list);
            showMsg('success', `Đã tìm thấy ${list.length} skill`);
        } catch (e) {
            showMsg('error', `Không thể tìm skill: ${e}`);
        } finally {
            setLoading(false);
        }
    };

    const handleInstall = async (skill: DiscoverableSkill) => {
        setLoading(true);
        try {
            await invoke('install_skill', { skillJson: JSON.stringify(skill) });
            showMsg('success', `Đã cài ${skill.name}`);
            await loadInstalled();
            // 标记为已安装
            setDiscovered(prev => prev.map(s => s.key === skill.key ? { ...s, installed: true } : s));
        } catch (e) {
            showMsg('error', `Không thể cài đặt: ${e}`);
        } finally {
            setLoading(false);
        }
    };

    const handleUninstall = (id: string, name: string) => {
        setConfirmDelete({ id, name });
        setConfirmInput('');
    };

    const executeUninstall = async () => {
        if (!confirmDelete) return;
        try {
            await invoke('uninstall_skill', { skillId: confirmDelete.id });
            showMsg('success', `Đã gỡ ${confirmDelete.name}`);
            setConfirmDelete(null);
            setConfirmInput('');
            await loadInstalled();
        } catch (e) {
            showMsg('error', `Không thể gỡ: ${e}`);
        }
    };

    const handleOpenDetail = async (skill: InstalledSkill) => {
        setDetailSkill(skill);
        try {
            const content = await invoke<string>('get_skill_content', { directory: skill.directory });
            setDetailContent(content);
        } catch {
            setDetailContent('Không đọc được SKILL.md');
        }
    };

    const handleToggleAppLink = async (app: string, enabled: boolean) => {
        if (linkingApp) return;
        setLinkingApp(app);
        try {
            await invoke('toggle_skill_app_link', { app, enabled });
            setAppStatus(prev => ({ ...prev, [app]: enabled }));
            showMsg('success', enabled ? `Đã liên kết ${app}` : `Đã ngắt liên kết ${app}`);
            await loadAppStatus();
        } catch (e) {
            showMsg('error', `Không thể thay đổi liên kết: ${e}`);
        } finally {
            setLinkingApp(null);
        }
    };

    const handleAddRepo = async () => {
        if (!newOwner || !newName) return;
        try {
            await invoke('add_skill_repo', { owner: newOwner, name: newName, branch: newBranch });
            showMsg('success', `Đã thêm ${newOwner}/${newName}`);
            setNewOwner('');
            setNewName('');
            setNewBranch('main');
            await loadRepos();
        } catch (e) {
            showMsg('error', `${e}`);
        }
    };

    const handleRemoveRepo = async (owner: string, name: string) => {
        try {
            await invoke('remove_skill_repo', { owner, name });
            await loadRepos();
        } catch (e) {
            showMsg('error', `${e}`);
        }
    };

    const handleSyncAll = async () => {
        try {
            await invoke('sync_all_skills');
            showMsg('success', 'Đồng bộ hoàn tất');
        } catch (e) {
            showMsg('error', `Đồng bộ thất bại: ${e}`);
        }
    };

    const handleSyncToServer = async () => {
        if (syncingServer) return;
        setSyncingServer(true);
        try {
            const r = await invoke<{ pushed: string[]; skipped: string[]; errors: [string, string][] }>(
                'remote_sync_skills'
            );
            const parts = [`Đã đẩy ${r.pushed.length}`];
            if (r.skipped.length) parts.push(`bỏ qua ${r.skipped.length}`);
            if (r.errors.length) parts.push(`lỗi ${r.errors.length}`);
            if (r.errors.length) {
                showMsg('error', `${parts.join(', ')}: ${r.errors[0][0]} - ${r.errors[0][1]}`);
            } else {
                showMsg('success', parts.join(', '));
            }
        } catch (e) {
            showMsg('error', `Không thể đồng bộ lên máy chủ: ${e}`);
        } finally {
            setSyncingServer(false);
        }
    };

    const filtered = installed.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
    );

    const filteredDiscover = discovered.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="skills-page">
            <div className="skills-header">
                <div>
                    <h2>Kỹ năng</h2>
                    <p className="skills-subtitle">Quản lý skill dùng chung và ứng dụng CLI được liên kết</p>
                </div>
                <div className="skills-tabs">
                    <button className={`tab-btn ${tab === 'installed' ? 'active' : ''}`} onClick={() => { setTab('installed'); loadInstalled(true); }}>
                        Đã cài ({installed.length})
                    </button>
                    <button className={`tab-btn ${tab === 'discover' ? 'active' : ''}`} onClick={() => { setTab('discover'); if (discovered.length === 0) handleDiscover(); }}>
                        Khám phá
                    </button>
                    <button className={`tab-btn ${tab === 'repos' ? 'active' : ''}`} onClick={() => setTab('repos')}>
                        Kho nguồn
                    </button>
                </div>
            </div>

            {message && (
                <div className={`settings-message ${message.type}`}>{message.text}</div>
            )}

            <div className="skills-search">
                <input
                    type="text"
                    placeholder="Tìm theo tên hoặc mô tả skill..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="search-input"
                />
                {tab === 'installed' && (
                    <>
                        <button className="btn btn-sm btn-ghost" onClick={handleSyncAll}>Đồng bộ tất cả</button>
                        {remoteMode === 'client' && (
                            <button
                                className="btn btn-sm btn-ghost"
                                onClick={handleSyncToServer}
                                disabled={syncingServer}
                                title="Đẩy toàn bộ skill cục bộ lên máy chủ, bỏ qua danh sách chặn"
                            >
                                {syncingServer ? 'Đang đồng bộ...' : 'Đồng bộ lên máy chủ'}
                            </button>
                        )}
                    </>
                )}
                {tab === 'discover' && (
                    <button className="btn btn-sm btn-primary" onClick={handleDiscover} disabled={loading}>
                        {loading ? 'Đang quét...' : 'Làm mới'}
                    </button>
                )}
            </div>

            {/* 已安装列表 */}
            {tab === 'installed' && (
                <>
                    {/* Trạng thái liên kết CLI */}
                    <div className="app-sync-bar">
                        {APPS.map(app => (
                            <button
                                type="button"
                                key={app}
                                className={`app-sync-item ${appStatus[app] ? 'linked' : ''}`}
                                role="switch"
                                aria-checked={appStatus[app] || false}
                                disabled={linkingApp !== null}
                                onClick={() => void handleToggleAppLink(app, !appStatus[app])}
                                title={appStatus[app] ? `Ngắt liên kết ${app}` : `Liên kết ${app}`}
                            >
                                <span className="app-sync-icon" aria-hidden="true">
                                    {linkingApp === app
                                        ? <LoaderCircle size={15} className="spinning" />
                                        : appStatus[app] ? <Check size={15} /> : <Unlink size={14} />}
                                </span>
                                <span className="app-sync-copy">
                                    <strong>{app}</strong>
                                    <small>{appStatus[app] ? 'Đã liên kết' : 'Chưa liên kết'}</small>
                                </span>
                                <Link2 size={14} className="app-sync-link" aria-hidden="true" />
                            </button>
                        ))}
                    </div>

                    <div className="skills-list">
                        {filtered.length === 0 ? (
                            <div className="skills-empty">Chưa có skill nào được cài</div>
                        ) : filtered.map(skill => (
                            <div key={skill.id} className="skill-card" onClick={() => handleOpenDetail(skill)} style={{ cursor: 'pointer' }}>
                                <div className="skill-info">
                                    <div className="skill-name">{skill.name}</div>
                                    <div className="skill-desc">{skill.description || 'Không có mô tả'}</div>
                                    <div className="skill-meta">
                                        {skill.source === 'github' && skill.repo_owner && (
                                            <span className="skill-source">{skill.repo_owner}/{skill.repo_name}</span>
                                        )}
                                        {skill.source === 'local' && <span className="skill-source">Cục bộ</span>}
                                    </div>
                                </div>
                                <button
                                    className="btn btn-sm btn-danger"
                                    onClick={(e) => { e.stopPropagation(); handleUninstall(skill.id, skill.name); }}
                                    title="Gỡ skill"
                                >
                                    Gỡ
                                </button>
                            </div>
                        ))}
                    </div>
                </>
            )}

            {/* 发现列表 */}
            {tab === 'discover' && (
                <div className="skills-list">
                    {loading && <div className="skills-empty">Đang quét kho GitHub...</div>}
                    {!loading && filteredDiscover.length === 0 && (
                        <div className="skills-empty">Nhấn “Làm mới” để tìm skill trong các kho nguồn</div>
                    )}
                    {filteredDiscover.map(skill => (
                        <div key={skill.key} className="skill-card">
                            <div className="skill-info">
                                <div className="skill-name">{skill.name}</div>
                                <div className="skill-desc">{skill.description || 'Không có mô tả'}</div>
                                <div className="skill-meta">
                                    <span className="skill-source">{skill.repo_owner}/{skill.repo_name}</span>
                                </div>
                            </div>
                            {skill.installed ? (
                                <span className="skill-installed-badge">Đã cài</span>
                            ) : (
                                <button
                                    className="btn btn-sm btn-primary"
                                    onClick={() => handleInstall(skill)}
                                    disabled={loading}
                                >
                                    Cài đặt
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* 仓库管理 */}
            {tab === 'repos' && (
                <div className="repos-section">
                    <div className="repo-list">
                        {repos.map(repo => (
                            <div key={`${repo.owner}/${repo.name}`} className="repo-item">
                                <div className="repo-info">
                                    <span className="repo-name">{repo.owner}/{repo.name}</span>
                                    <span className="repo-branch">{repo.branch}</span>
                                </div>
                                <button
                                    className="btn btn-sm btn-danger"
                                    onClick={() => handleRemoveRepo(repo.owner, repo.name)}
                                >
                                    Xóa kho
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="repo-add">
                        <input placeholder="owner" value={newOwner} onChange={e => setNewOwner(e.target.value)} className="repo-input" />
                        <span>/</span>
                        <input placeholder="repo" value={newName} onChange={e => setNewName(e.target.value)} className="repo-input" />
                        <input placeholder="branch" value={newBranch} onChange={e => setNewBranch(e.target.value)} className="repo-input small" />
                        <button className="btn btn-sm btn-primary" onClick={handleAddRepo}>Thêm kho</button>
                    </div>
                </div>
            )}
            {/* 删除确认弹窗 */}
            {confirmDelete && (
                <div className="skill-detail-overlay" onClick={() => setConfirmDelete(null)}>
                    <div className="skill-detail-modal confirm-delete-modal" onClick={e => e.stopPropagation()}>
                        <div className="detail-header">
                            <h2>Xác nhận gỡ skill</h2>
                            <button className="detail-close" onClick={() => setConfirmDelete(null)}>✕</button>
                        </div>
                        <div className="detail-content">
                            <p>Skill <strong>{confirmDelete.name}</strong> sẽ bị gỡ khỏi tất cả thư mục CLI đã liên kết.</p>
                            <p style={{ marginTop: '12px', color: 'var(--text-secondary)' }}>
                                Nhập tên skill <code>{confirmDelete.name}</code> để xác nhận:
                            </p>
                            <input
                                type="text"
                                className="search-input"
                                style={{ marginTop: '8px' }}
                                placeholder={confirmDelete.name}
                                value={confirmInput}
                                onChange={e => setConfirmInput(e.target.value)}
                                autoFocus
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && confirmInput === confirmDelete.name) {
                                        executeUninstall();
                                    }
                                }}
                            />
                        </div>
                        <div className="detail-footer">
                            <button className="btn btn-sm btn-ghost" onClick={() => setConfirmDelete(null)}>Hủy</button>
                            <button
                                className="btn btn-sm btn-danger"
                                disabled={confirmInput !== confirmDelete.name}
                                onClick={executeUninstall}
                            >
                                Gỡ skill
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Skill 详情弹窗 */}
            {detailSkill && (
                <div className="skill-detail-overlay" onClick={() => setDetailSkill(null)}>
                    <div className="skill-detail-modal" onClick={e => e.stopPropagation()}>
                        <div className="detail-header">
                            <div>
                                <h2>{detailSkill.name}</h2>
                                <p className="detail-desc">{detailSkill.description}</p>
                            </div>
                            <button className="detail-close" onClick={() => setDetailSkill(null)}>✕</button>
                        </div>
                        <div className="detail-content">
                            <Markdown>{detailContent}</Markdown>
                        </div>
                        <div className="detail-footer">
                            <button
                                className="btn btn-sm btn-danger"
                                onClick={() => { handleUninstall(detailSkill.id, detailSkill.name); setDetailSkill(null); }}
                            >
                                Gỡ skill
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { ChevronRight } from 'lucide-react';
import { RELAY_PRESETS, RelayPreset } from '../data/relay_presets';
import './AddRelayModal.css';

interface AddRelayModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSuccess?: () => void;
}

const GROUPS: Array<{ id: NonNullable<RelayPreset['group']>; label: string; note: string }> = [
    { id: '通用中转', label: 'RELAY TƯƠNG THÍCH OPENAI', note: 'Dành cho new-api, CLIProxyAPI, sub2api và các relay hỗ trợ /v1/responses.' },
    { id: 'CODING PLAN', label: 'CODING PLAN', note: 'Gói lập trình của nhà cung cấp; dùng Responses hoặc Chat Completions tùy dịch vụ.' },
    { id: '三方模型', label: 'API BÊN THỨ BA', note: 'API tính phí theo mức sử dụng như DeepSeek, Kimi, Qwen và OpenRouter.' },
    { id: '自定义', label: 'TÙY CHỈNH', note: 'Tự nhập base URL và API Key.' },
];

function ProviderLogo({ preset, large }: { preset: RelayPreset; large?: boolean }) {
    return (
        <div
            className={`cs-logo${large ? ' cs-logo--lg' : ''}`}
            style={{ background: preset.color ?? '#64748B' }}
            aria-hidden
        >
            {preset.mark ?? preset.name.slice(0, 2)}
        </div>
    );
}

function ProtocolBadge({ proto }: { proto: RelayPreset['relay_protocol'] }) {
    const text = proto === 'chat_completions' ? '/chat/completions' : '/v1/responses';
    return <span className="cs-rbadge cs-rbadge--mono">{text}</span>;
}

function ProviderCard({
    preset,
    selected,
    onSelect,
}: {
    preset: RelayPreset;
    selected: boolean;
    onSelect: (p: RelayPreset) => void;
}) {
    const isSubscription = preset.category === 'coding_plan';
    return (
        <button
            type="button"
            className={`cs-pcard${selected ? ' cs-pcard--selected' : ''}`}
            onClick={() => onSelect(preset)}
        >
            <ProviderLogo preset={preset} />
            <div className="cs-pcard__body">
                <div className="cs-pcard__top">
                    <span className="cs-pcard__name">{preset.name}</span>
                    <div className="cs-pcard__tags">
                        {isSubscription && <span className="cs-rbadge cs-rbadge--sub">Gói đăng ký</span>}
                        <ProtocolBadge proto={preset.relay_protocol} />
                    </div>
                </div>
                {preset.description && <div className="cs-pcard__desc">{preset.description}</div>}
            </div>
        </button>
    );
}

function Step1Picker({
    pickedId,
    onPick,
}: {
    pickedId: string | null;
    onPick: (p: RelayPreset) => void;
}) {
    const grouped = useMemo(() => {
        const map = new Map<string, RelayPreset[]>();
        for (const p of RELAY_PRESETS) {
            const key = p.group ?? '自定义';
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(p);
        }
        return map;
    }, []);

    return (
        <div>
            <div className="cs-relay-tip">
                Chọn một <strong>dịch vụ relay</strong>; base URL sẽ được điền sẵn và bước sau chỉ cần dán API Key.
                Bạn có thể thêm cùng một dịch vụ nhiều lần để dùng nhiều Coding Plan, rồi đặt tên tài khoản khác nhau để phân biệt.
                Cũng hỗ trợ thêm bằng deep link <code>codexswitch://</code>.
            </div>
            {GROUPS.map((g) => {
                const items = grouped.get(g.id) ?? [];
                if (items.length === 0) return null;
                return (
                    <div key={g.id} className="cs-relay-section">
                        <div className="cs-relay-section__head">
                            <span className="cs-relay-section__title">{g.label}</span>
                            <span className="cs-relay-section__note">{g.note}</span>
                        </div>
                        <div className="cs-relay-grid">
                            {items.map((p) => (
                                <ProviderCard
                                    key={p.id}
                                    preset={p}
                                    selected={pickedId === p.id}
                                    onSelect={onPick}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

interface Step2Props {
    preset: RelayPreset;
    name: string; setName: (v: string) => void;
    baseUrl: string; setBaseUrl: (v: string) => void;
    apiKey: string; setApiKey: (v: string) => void;
    protocol: 'responses' | 'chat_completions'; setProtocol: (v: 'responses' | 'chat_completions') => void;
    usagePreset: string | null; setUsagePreset: (v: string | null) => void;
    usageCookie: string; setUsageCookie: (v: string) => void;
    modelFallback: string; setModelFallback: (v: string) => void;
    modelMapText: string; setModelMapText: (v: string) => void;
    advOpen: boolean; setAdvOpen: (v: boolean) => void;
    onChangeProvider: () => void;
}

function Step2Form(props: Step2Props) {
    const {
        preset,
        name, setName, baseUrl, setBaseUrl, apiKey, setApiKey,
        protocol, setProtocol, usagePreset, setUsagePreset, usageCookie, setUsageCookie,
        modelFallback, setModelFallback, modelMapText, setModelMapText,
        advOpen, setAdvOpen, onChangeProvider,
    } = props;

    const needsCookie = usagePreset === 'mimo_token_plan';
    const keyPlaceholder = `${preset.auth_prefix ?? 'sk-'}••••••••`;

    return (
        <div>
            <div className="cs-selected-card">
                <ProviderLogo preset={preset} large />
                <div className="cs-selected-card__body">
                    <div className="cs-selected-card__top">
                        <span className="cs-selected-card__name">{preset.name}</span>
                        <ProtocolBadge proto={protocol} />
                    </div>
                    <div className="cs-selected-card__url">{baseUrl || '(base URL tùy chỉnh)'}</div>
                    {protocol === 'responses' && modelFallback && (
                        <div className="cs-rfield__hint">Sau khi lưu, bạn có thể chọn model này trong Codex mà không cần đổi tài khoản ChatGPT.</div>
                    )}
                </div>
                <button type="button" className="cs-selected-card__change" onClick={onChangeProvider}>
                    Đổi dịch vụ
                </button>
            </div>

            <div className="cs-rgrid2">
                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-name">
                        Tên tài khoản<span className="cs-rfield__req">*</span>
                    </label>
                    <input
                        id="cs-relay-name"
                        className="cs-rinput"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Ví dụ: Công việc · GLM Coding"
                    />
                </div>

                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-key">
                        API Key<span className="cs-rfield__req">*</span>
                        <span className="cs-rfield__hint">Tiền tố {preset.auth_prefix ?? 'sk-'}</span>
                    </label>
                    <input
                        id="cs-relay-key"
                        className="cs-rinput cs-rinput--mono"
                        type="password"
                        value={apiKey}
                        onChange={(e) => setApiKey(e.target.value)}
                        placeholder={keyPlaceholder}
                    />
                </div>

                <div className="cs-rfield cs-rfield--full">
                    <label className="cs-rfield__label" htmlFor="cs-relay-base">
                        Địa chỉ API (có thể sửa)<span className="cs-rfield__req">*</span>
                    </label>
                    <input
                        id="cs-relay-base"
                        className="cs-rinput cs-rinput--mono"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        placeholder="https://api.example.com/v1"
                    />
                    <span className="cs-rfield__hint">Preset chỉ điền địa chỉ mặc định. Nếu dùng relay riêng, hãy nhập đúng API URL và API Key của relay đó.</span>
                </div>

                {protocol === 'responses' && (
                    <div className="cs-rfield cs-rfield--full">
                        <label className="cs-rfield__label" htmlFor="cs-relay-model">
                            Model ID mặc định (có thể sửa)
                        </label>
                        <input id="cs-relay-model" className="cs-rinput cs-rinput--mono"
                            value={modelFallback} onChange={(e) => setModelFallback(e.target.value)}
                            placeholder="Nhập model ID mà API này thực sự hỗ trợ" />
                        <span className="cs-rfield__hint">Model sẽ xuất hiện trong danh sách của Codex; phần nâng cao cho phép thêm ánh xạ khác.</span>
                    </div>
                )}

                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-proto">
                        Giao thức upstream
                        <span className="cs-rfield__hint">Wire format mà relay hỗ trợ</span>
                    </label>
                    <select
                        id="cs-relay-proto"
                        className="cs-rselect"
                        value={protocol}
                        onChange={(e) => setProtocol(e.target.value as 'responses' | 'chat_completions')}
                    >
                        <option value="responses">responses · /v1/responses</option>
                        <option value="chat_completions">chat_completions · /chat/completions</option>
                    </select>
                </div>

                <div className="cs-rfield">
                    <label className="cs-rfield__label" htmlFor="cs-relay-usage">
                        Kiểm tra hạn mức/số dư
                        <span className="cs-rfield__hint">Mặc định tự nhận diện</span>
                    </label>
                    <select
                        id="cs-relay-usage"
                        className="cs-rselect"
                        value={usagePreset ?? 'auto'}
                        onChange={(e) => setUsagePreset(e.target.value || null)}
                    >
                        <option value="auto">Tự nhận diện (khuyên dùng · hỗ trợ new-api và sub2api)</option>
                        <option value="new_api_dashboard">new_api_dashboard · /v1/dashboard/billing/*</option>
                        <option value="openai_compat">openai_compat · GET /v1/usage</option>
                        <option value="glm_zhipu">glm_zhipu · hạn mức GLM</option>
                        <option value="kimi_coding">kimi_coding · Kimi Coding 5H / 7D</option>
                        <option value="mimo_token_plan">mimo_token_plan · cần Cookie</option>
                        <option value="">Không kiểm tra</option>
                    </select>
                </div>

                {needsCookie && (
                    <div className="cs-rfield cs-rfield--full">
                        <label className="cs-rfield__label" htmlFor="cs-relay-cookie">
                            Cookie hạn mức MiMo
                            <span className="cs-rfield__hint">Sao chép Cookie header từ Network của platform.xiaomimimo.com</span>
                        </label>
                        <textarea
                            id="cs-relay-cookie"
                            className="cs-rtextarea cs-rinput--mono"
                            rows={3}
                            value={usageCookie}
                            onChange={(e) => setUsageCookie(e.target.value)}
                            placeholder="Cookie: api-platform_serviceToken=...; userId=...; api-platform_ph=..."
                            style={{ resize: 'vertical', fontSize: 12 }}
                        />
                    </div>
                )}
            </div>

            <div className="cs-radv">
                <button
                    type="button"
                    className="cs-radv__toggle"
                    onClick={() => setAdvOpen(!advOpen)}
                >
                    <ChevronRight
                        size={14}
                        className={`cs-radv__chevron${advOpen ? ' cs-radv__chevron--open' : ''}`}
                    />
                    Cài đặt nâng cao (model fallback / ánh xạ model)
                </button>
                {advOpen && (
                    <div className="cs-radv__body">
                        {protocol !== 'responses' && <div className="cs-rfield">
                            <label className="cs-rfield__label" htmlFor="cs-relay-fallback">
                                Model fallback
                                <span className="cs-rfield__hint">Dùng model này khi model từ client không có trong bảng ánh xạ.</span>
                            </label>
                            <input
                                id="cs-relay-fallback"
                                className="cs-rinput cs-rinput--mono"
                                value={modelFallback}
                                onChange={(e) => setModelFallback(e.target.value)}
                                placeholder={preset.model_fallback ?? 'Để trống = giữ nguyên model từ client'}
                            />
                        </div>}
                        <div className="cs-rfield">
                            <label className="cs-rfield__label" htmlFor="cs-relay-modelmap">
                                Bảng ánh xạ model
                                <span className="cs-rfield__hint">Mỗi dòng: client_model=upstream_model</span>
                            </label>
                            <textarea
                                id="cs-relay-modelmap"
                                className="cs-rtextarea cs-rinput--mono"
                                rows={4}
                                value={modelMapText}
                                onChange={(e) => setModelMapText(e.target.value)}
                                placeholder={'gpt-5.5=glm-5.1\ngpt-4o=glm-5\ngpt-4o-mini=glm-5.1-x'}
                                style={{ resize: 'vertical', fontSize: 12 }}
                            />
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function parseModelMapText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq <= 0) continue;
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim();
        if (k && v) out[k] = v;
    }
    return out;
}

export function AddRelayModal({ isOpen, onClose, onSuccess }: AddRelayModalProps) {
    const [step, setStep] = useState<1 | 2>(1);
    const [picked, setPicked] = useState<RelayPreset | null>(null);

    const [name, setName] = useState('');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [protocol, setProtocol] = useState<'responses' | 'chat_completions'>('responses');
    const [usagePreset, setUsagePreset] = useState<string | null>(null);
    const [usageCookie, setUsageCookie] = useState('');
    const [modelFallback, setModelFallback] = useState('');
    const [modelMapText, setModelMapText] = useState('');
    const [advOpen, setAdvOpen] = useState(false);

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // 重置 step 当 modal 关闭
    useEffect(() => {
        if (!isOpen) {
            setStep(1);
            setPicked(null);
            setName('');
            setApiKey('');
            setUsageCookie('');
            setAdvOpen(false);
            setError(null);
            setSubmitting(false);
        }
    }, [isOpen]);

    const handlePick = (p: RelayPreset) => {
        setPicked(p);
        setName(p.name);
        setBaseUrl(p.base_url);
        setProtocol(p.relay_protocol ?? 'responses');
        setUsagePreset(p.usage_preset ?? null);
        setUsageCookie('');
        setModelFallback(p.model_fallback ?? '');
        setModelMapText(p.model_map
            ? Object.entries(p.model_map).map(([k, v]) => `${k}=${v}`).join('\n')
            : '');
        setAdvOpen(false);
        setError(null);
        setStep(2);
    };

    const handleBack = () => {
        setStep(1);
        setError(null);
    };

    const handleSubmit = async () => {
        if (!picked) return;
        setError(null);
        if (!name.trim()) { setError('Tên tài khoản không được để trống.'); return; }
        if (!/^https?:\/\//.test(baseUrl.trim())) {
            setError('Base URL phải bắt đầu bằng http:// hoặc https://.');
            return;
        }
        // Ollama 等本地推理不需要真 key，宽松校验：非空 + ≥1 字符即可。
        // 真的 sk- / tp- key 通常 ≥30 字符，这里不卡死方便本地场景。
        if (apiKey.trim().length < 1) { setError('API Key không được để trống.'); return; }
        if (usagePreset === 'mimo_token_plan' && !usageCookie.trim()) {
            setError('Để kiểm tra hạn mức MiMo, hãy dán Cookie từ platform.xiaomimimo.com; nếu không cần, chọn “Không kiểm tra”.');
            return;
        }
        setSubmitting(true);
        try {
            const modelMap = parseModelMapText(modelMapText);
            await invoke('add_relay_account', {
                name: name.trim(),
                baseUrl: baseUrl.trim(),
                apiKey: apiKey.trim(),
                homepage: picked.homepage ?? null,
                usagePreset: usagePreset ?? null,
                usageCookie: usageCookie.trim() || null,
                notes: `from preset:${picked.id}`,
                modelMap: Object.keys(modelMap).length > 0 ? modelMap : null,
                modelFallback: modelFallback.trim() || null,
                relayProtocol: protocol === 'responses' ? null : protocol,
                relayCategory: picked.category ?? 'aggregator',
            });
            await emit('accounts-updated');
            onSuccess?.();
            onClose();
        } catch (e) {
            setError(typeof e === 'string' ? e : String(e));
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="cs-relay-modal cs-relay-modal__overlay" onClick={onClose}>
            <div className="cs-relay-modal__panel" onClick={(e) => e.stopPropagation()}>
                <div className="cs-relay-modal__header">
                    <div className="cs-relay-modal__title">
                        <div className="cs-relay-modal__icon">⇄</div>
                        <h2>Thêm relay/API</h2>
                        <span className="cs-relay-modal__sub">Chọn preset · nhập API Key</span>
                    </div>
                    <button className="cs-relay-modal__close" onClick={onClose}>×</button>
                </div>

                <div className="cs-relay-steps">
                    <div className={`cs-relay-step${step === 1 ? ' cs-relay-step--active' : ' cs-relay-step--done'}`}>
                        <span className="cs-relay-step__num">{step > 1 ? '✓' : '1'}</span>
                        Chọn dịch vụ
                    </div>
                    <div className={`cs-relay-step${step === 2 ? ' cs-relay-step--active' : ''}`}>
                        <span className="cs-relay-step__num">2</span>
                        Nhập thông tin xác thực
                    </div>
                </div>

                <div className="cs-relay-modal__body">
                    {step === 1 ? (
                        <Step1Picker
                            pickedId={picked?.id ?? null}
                            onPick={handlePick}
                        />
                    ) : picked ? (
                        <>
                            <Step2Form
                                preset={picked}
                                name={name} setName={setName}
                                baseUrl={baseUrl} setBaseUrl={setBaseUrl}
                                apiKey={apiKey} setApiKey={setApiKey}
                                protocol={protocol} setProtocol={setProtocol}
                                usagePreset={usagePreset} setUsagePreset={setUsagePreset}
                                usageCookie={usageCookie} setUsageCookie={setUsageCookie}
                                modelFallback={modelFallback} setModelFallback={setModelFallback}
                                modelMapText={modelMapText} setModelMapText={setModelMapText}
                                advOpen={advOpen} setAdvOpen={setAdvOpen}
                                onChangeProvider={handleBack}
                            />
                            {error && <div className="cs-rerror">{error}</div>}
                        </>
                    ) : null}
                </div>

                <div className="cs-relay-modal__footer">
                    {step === 2 ? (
                        <button className="cs-rbtn cs-rbtn--ghost" onClick={handleBack} disabled={submitting}>
                            ← Chọn lại dịch vụ
                        </button>
                    ) : (
                        <span style={{ fontSize: 11, color: 'var(--r-fg-muted)' }}>
                            Chọn dịch vụ để sang bước tiếp theo; base URL sẽ được điền sẵn.
                        </span>
                    )}
                    <div style={{ display: 'flex', gap: 8 }}>
                        <button className="cs-rbtn cs-rbtn--ghost" onClick={onClose} disabled={submitting}>
                            Hủy
                        </button>
                        {step === 2 && (
                            <button
                                className="cs-rbtn cs-rbtn--purple"
                                onClick={handleSubmit}
                                disabled={submitting}
                            >
                                {submitting ? 'Đang thêm…' : 'Thêm relay/API'}
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

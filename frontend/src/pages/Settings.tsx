import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { useTheme, setTheme, useAccent, setAccent, ACCENTS, type Accent } from '../theme'
import { useT, type Lang } from '../i18n'
import {
  useShowReasoning, setShowReasoning,
  useMonoAnswers, setMonoAnswers,
  useStartView, setStartView, START_VIEWS, type StartView,
  useDefaultMode, setDefaultMode, type PromptMode,
} from '../prefs'
import { versionApi, settingsApi, runsApi, type VersionInfo, type AppSettings, type AppSettingsPatch } from '../api'
import { clearNewRunSession, RUNS_CHANGED_EVENT } from './NewRun'
import { Button, Segmented } from '../components/ui'
import { SliderField } from '../components/SliderField'
import {
  IconCopy, IconCheck, IconWarning,
  IconSliders, IconContrast, IconLayers, IconCode, IconDatabase, IconInfo, IconMetrics,
} from '../components/icons'
import { MetricsRegistry } from '../components/MetricsRegistry'

const SETTINGS_CSS = `
  .set-nav-item {
    display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
    padding: 8px 12px; border: none; border-radius: 7px; background: none; cursor: pointer;
    font-size: var(--fs-base); font-family: var(--font-sans); color: var(--text-muted);
    transition: color 0.12s, background 0.12s;
  }
  .set-nav-item:hover { background: var(--bg-elevated); color: var(--text-secondary); }
  .set-nav-item.on { background: var(--bg-elevated); color: var(--text-bright); }
  .set-swatch {
    width: 22px; height: 22px; border-radius: 6px; border: none; cursor: pointer; padding: 0;
    box-sizing: border-box;
  }
  .set-swatch.on { outline: 1.5px solid var(--text-bright); outline-offset: 2px; }
`

// The section list drives both the nav and the render order, so a new section
// cannot be added to one and forgotten in the other.
const SECTIONS = ['general', 'appearance', 'models', 'metrics', 'code', 'server', 'about'] as const
type SectionId = typeof SECTIONS[number]

const SECTION_TITLE: Record<SectionId, string> = {
  general: 'settings.general',
  appearance: 'settings.appearance',
  models: 'settings.models',
  metrics: 'metrics.title',
  code: 'settings.codeExecTitle',
  server: 'settings.server',
  about: 'settings.aboutTitle',
}

const SECTION_ICON: Record<SectionId, (p: { size?: number }) => React.JSX.Element> = {
  general: IconSliders,
  appearance: IconContrast,
  models: IconLayers,
  metrics: IconMetrics,
  code: IconCode,
  server: IconDatabase,
  about: IconInfo,
}

// Literal keys, not a `t(\`settings.startView${i}\`)` template: i18n.keys.test.ts
// only expands the template form for indices 0–2, so a six-option list built
// that way would sail past the audit and render raw keys at the user.
const START_VIEW_LABEL: Record<StartView, string> = {
  '/run': 'nav.test',
  '/results': 'nav.results',
  '/history': 'nav.history',
  '/datasets': 'nav.datasets',
  '/library': 'nav.library',
  '/providers': 'nav.providers',
}

const ACCENT_LABEL: Record<Accent, string> = {
  purple: 'settings.accentPurple',
  blue: 'settings.accentBlue',
  teal: 'settings.accentTeal',
  rose: 'settings.accentRose',
}

// The swatch has to paint its colour before it is selected, so it cannot read
// var(--accent) — that is whatever is active. These mirror the dark values in
// tokens.css; they are a preview of a choice, not the choice itself.
const ACCENT_SWATCH: Record<Accent, string> = {
  purple: '#7F77DD',
  blue: '#5B9BE0',
  teal: '#3FB0A0',
  rose: '#D97393',
}

// Long enough that the config write is one per gesture rather than one per
// slider tick: every setter is serialized behind an atomic file write with a
// Windows retry loop that sleeps, so a drag would otherwise queue dozens.
const SAVE_DEBOUNCE_MS = 250

export function Settings() {
  const { t: tr, lang, setLang } = useT()
  const location = useLocation()
  const theme = useTheme()
  const accent = useAccent()
  const showReasoning = useShowReasoning()
  const monoAnswers = useMonoAnswers()
  const startView = useStartView()
  const defaultMode = useDefaultMode()

  const [info, setInfo] = useState<VersionInfo | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [saveError, setSaveError] = useState(false)
  const [active, setActive] = useState<SectionId>('general')

  const pending = useRef<AppSettingsPatch>({})
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    versionApi.get().then(setInfo).catch(() => {})
    settingsApi.get().then(setSettings).catch(() => {})
  }, [])

  // Local state moves at once, the server catches up. On failure the server's
  // own answer wins — an optimistic value left on screen after a rejected write
  // is the page lying about what is stored.
  const patch = useCallback((change: AppSettingsPatch, optimistic: Partial<AppSettings>) => {
    setSaveError(false)
    setSettings(prev => prev && { ...prev, ...optimistic })
    pending.current = {
      ...pending.current,
      ...change,
      ...(change.runDefaults ? { runDefaults: { ...pending.current.runDefaults, ...change.runDefaults } } : {}),
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const body = pending.current
      pending.current = {}
      settingsApi.update(body)
        .then(setSettings)
        .catch(() => {
          setSaveError(true)
          settingsApi.get().then(setSettings).catch(() => {})
        })
    }, SAVE_DEBOUNCE_MS)
  }, [])

  useEffect(() => () => clearTimeout(timer.current), [])

  // Deep links: /settings#code is what the "enable it in Settings" error points at.
  useEffect(() => {
    const id = SECTIONS.find(s => s === location.hash.replace('#', ''))
    if (id) setActive(id)
  }, [location.hash])

  const runDefaults = settings?.runDefaults ?? {}

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
      <style>{SETTINGS_CSS}</style>

      <nav
        role="tablist"
        aria-orientation="vertical"
        style={{
          width: 214, minWidth: 214, flexShrink: 0, borderRight: '0.5px solid var(--border)',
          display: 'flex', flexDirection: 'column', gap: 2, padding: '24px 12px 16px', overflowY: 'auto',
        }}
      >
        <h1 style={{
          fontSize: 'var(--fs-lg)', fontWeight: 600, color: 'var(--text-bright)',
          fontFamily: 'var(--font-sans)', padding: '0 12px 12px',
        }}>
          {tr('settings.title')}
        </h1>
        {SECTIONS.map(id => {
          const Icon = SECTION_ICON[id]
          return (
            <button
              key={id}
              role="tab"
              id={`set-tab-${id}`}
              aria-selected={active === id}
              aria-controls={`set-${id}`}
              className={`set-nav-item${active === id ? ' on' : ''}`}
              onClick={() => setActive(id)}
            >
              <span style={{ display: 'flex', color: active === id ? 'var(--accent)' : 'var(--text-muted)' }}>
                <Icon size={14} />
              </span>
              {tr(SECTION_TITLE[id])}
            </button>
          )
        })}
        <div style={{
          marginTop: 'auto', padding: '12px', fontSize: 'var(--fs-sm)',
          color: saveError ? 'var(--warning)' : 'var(--text-muted)', lineHeight: 1.5,
        }}>
          {saveError ? tr('settings.saveFailed') : tr('settings.autosaved')}
        </div>
      </nav>

      <div style={{
        flex: 1, minWidth: 0, overflowY: 'auto', padding: '24px 32px 48px',
        display: 'flex', flexDirection: 'column', gap: 24,
      }}>
        <Section active={active} id="general" title={tr('settings.general')} subtitle={tr('settings.generalSub')}>
          <Card label={tr('settings.language')} description={tr('settings.languageHint')}>
            <Segmented
              value={lang}
              onChange={setLang}
              options={[
                { value: 'en' as Lang, label: 'English' },
                { value: 'ru' as Lang, label: 'Русский' },
              ]}
            />
          </Card>
          <Card label={tr('settings.startView')} description={tr('settings.startViewHint')}>
            <Select
              value={startView}
              onChange={setStartView}
              options={START_VIEWS.map(v => ({ value: v, label: tr(START_VIEW_LABEL[v]) }))}
            />
          </Card>
          <Card label={tr('settings.defaultMode')} description={tr('settings.defaultModeHint')}>
            <Select
              value={defaultMode}
              onChange={setDefaultMode}
              options={([0, 1, 2] as PromptMode[]).map(m => ({ value: m, label: tr(`run.mode${m}`) }))}
            />
          </Card>
        </Section>

        <Section active={active} id="appearance" title={tr('settings.appearance')} subtitle={tr('settings.appearanceSub')}>
          <Card label={tr('settings.theme')}>
            <Segmented
              value={theme}
              onChange={setTheme}
              options={[
                { value: 'dark' as const, label: tr('settings.themeDark') },
                { value: 'light' as const, label: tr('settings.themeLight') },
                { value: 'system' as const, label: tr('settings.themeSystem') },
              ]}
            />
          </Card>
          <Card label={tr('settings.accent')} description={tr('settings.accentHint')}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} role="radiogroup" aria-label={tr('settings.accent')}>
              {ACCENTS.map(a => (
                <button
                  key={a}
                  className={`set-swatch${accent === a ? ' on' : ''}`}
                  style={{ background: ACCENT_SWATCH[a] }}
                  onClick={() => setAccent(a)}
                  title={tr(ACCENT_LABEL[a])}
                  aria-label={tr(ACCENT_LABEL[a])}
                  aria-checked={accent === a}
                  role="radio"
                />
              ))}
            </div>
          </Card>
          <Card label={tr('settings.monoAnswers')} description={tr('settings.monoAnswersHint')}>
            <Segmented
              value={monoAnswers}
              onChange={setMonoAnswers}
              options={[
                { value: true, label: tr('common.on') },
                { value: false, label: tr('common.off') },
              ]}
            />
          </Card>
        </Section>

        <Section active={active} id="models" title={tr('settings.models')} subtitle={tr('settings.modelsSub')}>
          <Card label={tr('settings.showReasoning')} description={tr('settings.showReasoningHint')}>
            <Segmented
              value={showReasoning}
              onChange={setShowReasoning}
              options={[
                { value: true, label: tr('common.on') },
                { value: false, label: tr('common.off') },
              ]}
            />
          </Card>
          <Card label={tr('settings.temperature')} description={tr('settings.temperatureHint')}>
            <div style={{ width: 240 }}>
              <SliderField
                label=""
                min={0}
                max={2}
                step={0.1}
                allowAuto
                accent={runDefaults.temperature != null}
                value={settings ? runDefaults.temperature ?? null : null}
                onChange={v => patch(
                  { runDefaults: { temperature: v } },
                  { runDefaults: { ...runDefaults, ...(v == null ? { temperature: undefined } : { temperature: v }) } },
                )}
              />
            </div>
          </Card>
          <Card label={tr('settings.maxTokens')} description={tr('settings.maxTokensHint')}>
            <div style={{ width: 240 }}>
              <SliderField
                label=""
                min={256}
                max={32000}
                step={256}
                allowAuto
                accent={runDefaults.maxOutputTokens != null}
                value={settings ? runDefaults.maxOutputTokens ?? null : null}
                onChange={v => patch(
                  { runDefaults: { maxOutputTokens: v } },
                  { runDefaults: { ...runDefaults, ...(v == null ? { maxOutputTokens: undefined } : { maxOutputTokens: v }) } },
                )}
              />
            </div>
          </Card>
        </Section>

        <Section active={active} id="metrics" title={tr('metrics.title')} subtitle={tr('metrics.subtitle')}>
          <MetricsRegistry />
        </Section>

        <Section active={active} id="code" title={tr('settings.codeExecTitle')} subtitle={tr('settings.codeExecSub')}>
          <Card label={tr('settings.codeExec')}>
            <Segmented
              value={settings ? settings.codeExecution : null}
              disabled={!settings}
              onChange={v => patch({ codeExecution: v }, { codeExecution: v })}
              options={[
                { value: true, label: tr('common.on') },
                { value: false, label: tr('common.off') },
              ]}
            />
          </Card>
          <WarningCard>{tr('settings.codeExecHint')}</WarningCard>
          <Card label={tr('settings.execTimeout')} description={tr('settings.execTimeoutHint')}>
            <div style={{ width: 240 }}>
              <SliderField
                label=""
                min={1}
                max={120}
                step={1}
                unit="s"
                value={settings ? Math.round(settings.codeExecTimeoutMs / 1000) : null}
                onChange={v => v != null && patch(
                  { codeExecTimeoutMs: v * 1000 },
                  { codeExecTimeoutMs: v * 1000 },
                )}
              />
            </div>
          </Card>
        </Section>

        <Section active={active} id="server" title={tr('settings.server')} subtitle={tr('settings.serverSub')}>
          <Card label={tr('settings.port')}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)', color: 'var(--text-muted)' }}>
              {info?.runtime.port != null ? String(info.runtime.port) : '…'}
            </span>
          </Card>
          <PathCard label={tr('settings.config')} value={info?.runtime.configPath ?? null} />
          <PathCard label={tr('settings.database')} value={info?.runtime.dbPath ?? null} />
          <ClearHistoryCard />
        </Section>

        <Section active={active} id="about" title={tr('settings.aboutTitle')}>
          <UpdateRow info={info} onChecked={setInfo} />
          <div style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', lineHeight: 1.6, padding: '0 4px' }}>
            {tr('settings.aboutText')}
            {info?.repoUrl && (
              <>{' '}<a href={info.repoUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>GitHub →</a></>
            )}
          </div>
        </Section>
      </div>
    </div>
  )
}

// One pane at a time. Unmounting the inactive ones is deliberate rather than
// hiding them: nothing here holds unsaved state — every control writes on
// change — so a pane costs nothing to rebuild, and a hidden pane would still
// put its rows in the tab order and in Ctrl-F.
function Section({ active, id, title, subtitle, children }: {
  active: SectionId
  id: SectionId
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  if (active !== id) return null
  return (
    <section
      id={`set-${id}`}
      role="tabpanel"
      aria-labelledby={`set-tab-${id}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <h2 style={{ fontSize: 'var(--fs-base)', fontWeight: 600, color: 'var(--text-bright)', fontFamily: 'var(--font-sans)' }}>
          {title}
        </h2>
        {subtitle && (
          <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{subtitle}</span>
        )}
      </div>
      {children}
    </section>
  )
}

function Card({ label, description, children }: {
  label: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap',
      background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>{label}</span>
        {description && (
          <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-muted)', fontFamily: 'var(--font-sans)' }}>{description}</span>
        )}
      </div>
      {children}
    </div>
  )
}

function WarningCard({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', gap: 12, alignItems: 'flex-start',
      background: 'var(--warning-bg)', border: '0.5px solid var(--warning-dim)',
      borderRadius: 'var(--radius-md)', padding: '12px 16px',
    }}>
      <span style={{ color: 'var(--warning)', display: 'flex', marginTop: 2 }}><IconWarning size={14} /></span>
      <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', lineHeight: 1.55, fontFamily: 'var(--font-sans)' }}>
        {children}
      </span>
    </div>
  )
}

// A read-only path plus a copy button. The button is disabled until the value
// arrives — copying the "…" placeholder would look like it worked.
function PathCard({ label, value }: { label: string; value: string | null }) {
  const { t: tr } = useT()
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (!value) return
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* no clipboard permission — the path is still on screen */ }
  }

  return (
    <Card label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md)', color: 'var(--text-muted)',
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {value ?? '…'}
        </span>
        <Button small onClick={() => void copy()} disabled={!value} title={tr('title.copy')} style={{ flexShrink: 0 }}>
          {copied ? <IconCheck size={11} /> : <IconCopy size={11} />}
          {copied ? tr('settings.copied') : tr('title.copy')}
        </Button>
      </div>
    </Card>
  )
}

// Two-step rather than window.confirm: this is the only action in the app with
// an unbounded blast radius, jsdom does not implement confirm() so it could not
// be tested, and a native dialog cannot carry the "datasets are kept" clause.
function ClearHistoryCard() {
  const { t: tr } = useT()
  const [arming, setArming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ deleted: number; skipped: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const disarm = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => () => clearTimeout(disarm.current), [])

  function arm() {
    setArming(true)
    setDone(null)
    setFailed(false)
    clearTimeout(disarm.current)
    disarm.current = setTimeout(() => setArming(false), 8000)
  }

  async function confirm() {
    clearTimeout(disarm.current)
    setBusy(true)
    try {
      const res = await runsApi.clearAll()
      setDone(res)
      setArming(false)
      // The open conversation points at a run that no longer exists, and the
      // sidebar's recent list is now stale.
      clearNewRunSession()
      window.dispatchEvent(new Event(RUNS_CHANGED_EVENT))
    } catch {
      setFailed(true)
      setArming(false)
    } finally {
      setBusy(false)
    }
  }

  const status = failed ? tr('settings.clearFailed')
    : done ? [
      tr('settings.cleared', { n: done.deleted }),
      ...(done.skipped > 0 ? [tr('settings.clearedSkipped', { n: done.skipped })] : []),
    ].join(' · ')
    : null

  return (
    <Card label={tr('settings.clearHistory')} description={status ?? tr('settings.clearHistoryHint')}>
      {arming ? (
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <Button small onClick={() => { clearTimeout(disarm.current); setArming(false) }}>
            {tr('common.cancel')}
          </Button>
          <Button variant="danger" small onClick={() => void confirm()} disabled={busy}>
            {tr('settings.clearConfirm')}
          </Button>
        </div>
      ) : (
        <Button variant="danger" small onClick={arm} style={{ flexShrink: 0 }}>{tr('settings.clear')}</Button>
      )}
    </Card>
  )
}

function UpdateRow({ info, onChecked }: { info: VersionInfo | null; onChecked: (v: VersionInfo) => void }) {
  const { t: tr } = useT()
  const [checking, setChecking] = useState(false)

  async function check() {
    setChecking(true)
    try {
      onChecked(await versionApi.get(true))
    } catch {
      if (info) onChecked({ ...info, checkError: 'network' })
    } finally {
      setChecking(false)
    }
  }

  const isDev = info?.current.builtAt == null
  // 'network' (couldn't reach GitHub) and 'missing' (GitHub has nothing to
  // compare against yet) are different truths — never report one as the other.
  const status = !info ? ''
    : isDev ? tr('settings.devBuild')
    : info.checkError === 'network' ? tr('settings.checkFailed')
    : info.checkError === 'missing' ? tr('settings.noPublished')
    : info.hasUpdate ? `${tr('update.available')} — \`benchy update\``
    : tr('settings.upToDate')
  const statusColor = !info || isDev || info.checkError === 'missing' ? 'var(--text-muted)'
    : info.checkError === 'network' ? 'var(--warning)'
    : info.hasUpdate ? 'var(--accent)'
    : 'var(--success)'

  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      background: 'var(--bg-elevated)', border: '0.5px solid var(--border)',
      borderRadius: 'var(--radius-md)', padding: '12px 16px',
    }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
        <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-primary)' }}>
          {tr('settings.build')}
          <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
            {info?.current.sha ?? '…'}
          </span>
        </span>
        {status && (
          <span style={{ fontSize: 'var(--fs-md)', color: statusColor, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {status}
          </span>
        )}
      </div>
      <Button small onClick={check} disabled={checking || isDev} style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        {checking ? tr('settings.checking') : tr('settings.checkUpdates')}
      </Button>
    </div>
  )
}

// A plain <select> styled to match the cards. Two dropdowns do not justify a
// bespoke popover, and the native control keeps keyboard and mobile behaviour.
function Select<T extends string | number>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  return (
    <select
      value={String(value)}
      onChange={e => {
        const picked = options.find(o => String(o.value) === e.target.value)
        if (picked) onChange(picked.value)
      }}
      style={{
        background: 'var(--bg-base)', border: '0.5px solid var(--border)', borderRadius: 7,
        padding: '7px 12px', color: 'var(--text-primary)',
        fontSize: 'var(--fs-md)', fontFamily: 'var(--font-mono)', cursor: 'pointer', flexShrink: 0,
      }}
    >
      {options.map(o => (
        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
      ))}
    </select>
  )
}

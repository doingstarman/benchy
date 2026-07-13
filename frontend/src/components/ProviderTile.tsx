import { useT } from '../i18n'
import type { Provider } from '../../../src/types'

interface ProviderTileProps {
  provider: Provider
  onClick: () => void
}

export function ProviderTile({ provider, onClick }: ProviderTileProps) {
  const { t } = useT()
  const isConnected = provider.enabled && (!!provider.apiKey || !!provider.baseUrl)

  return (
    <button
      onClick={onClick}
      style={{
        background: 'var(--bg-elevated)',
        border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius-md)',
        padding: '14px 16px',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        transition: 'border-color 0.15s',
        width: '100%',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--border-hover)')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = 'var(--border)')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, color: 'var(--text-bright)', fontWeight: 500 }}>
          {provider.name}
        </span>
        <span style={{
          width: 7, height: 7, borderRadius: '50%',
          background: isConnected ? 'var(--success)' : 'var(--text-muted)',
          marginTop: 4, flexShrink: 0,
        }} />
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)' }}>
        {provider.models.length > 0
          ? provider.models.slice(0, 2).join(', ') + (provider.models.length > 2 ? ` +${provider.models.length - 2}` : '')
          : t('tile.noModels')}
      </div>
    </button>
  )
}

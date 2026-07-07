interface ArtifactPreviewProps {
  html: string
  reloadKey?: number
}

// No allow-same-origin: generated code can't reach the parent page's storage
// or session. Sandboxed scripts can still make outbound network calls —
// that's inherent to the sandbox model, same as Claude.ai's own artifacts.
export function ArtifactPreview({ html, reloadKey = 0 }: ArtifactPreviewProps) {
  return (
    <iframe
      key={reloadKey}
      sandbox="allow-scripts"
      srcDoc={html}
      title="Artifact preview"
      style={{ display: 'block', flex: '1 1 auto', minHeight: 0, width: '100%', height: '100%', border: 'none', background: '#fff' }}
    />
  )
}

import { Component } from 'react'
import type { ReactNode } from 'react'

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? (
      <main className="auth-page">
        <section className="resource-error">
          <div>
            <h1>Bu ekran açılamadı.</h1>
            <p>Güncel uygulama dosyalarını almak için sayfayı yenileyin.</p>
          </div>
          <button className="button button--primary" onClick={() => location.reload()}>
            Sayfayı yenile
          </button>
        </section>
      </main>
    ) : (
      this.props.children
    )
  }
}

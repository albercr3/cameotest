import React from 'react';

interface ErrorBoundaryProps {
  onReset?: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('UI crashed', error, info);
  }

  handleReset = () => {
    this.setState({ error: null });
    if (this.props.onReset) {
      this.props.onReset();
    } else {
      window.location.reload();
    }
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '100vh',
            padding: '24px',
            background: '#0f172a',
            color: '#e2e8f0',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              maxWidth: 520,
              width: '100%',
              padding: '24px',
              borderRadius: 12,
              background: '#111827',
              boxShadow: '0 15px 40px rgba(0, 0, 0, 0.35)',
              border: '1px solid #1f2937',
            }}
          >
            <h1 style={{ fontSize: '1.5rem', marginBottom: '12px' }}>Something went wrong</h1>
            <p style={{ marginBottom: '16px', color: '#cbd5e1' }}>{error.message}</p>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: '10px 16px',
                background: '#38bdf8',
                color: '#0b1021',
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                fontWeight: 600,
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

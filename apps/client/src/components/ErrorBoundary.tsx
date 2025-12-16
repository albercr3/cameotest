import React from 'react';

interface ErrorBoundaryProps {
  onReset: () => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
  info: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { error: null, info: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error, info: null };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('UI crashed', error, info);
    this.setState({ error, info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
    this.props.onReset();
  };

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="error-screen">
          <div className="error-screen__card">
            <p className="pill pill--muted">Something went wrong</p>
            <h1>We couldn’t render this workspace</h1>
            <p className="lede">
              The UI hit an unexpected error. The console has the full details so we can debug it quickly.
            </p>
            <pre className="error-screen__message">{error.message}</pre>
            <button type="button" className="button" onClick={this.handleReset}>
              Back to landing
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

interface ErrorBannerProps {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner(props: ErrorBannerProps) {
  return (
    <div class="error-banner">
      <span>{props.message}</span>
      <button type="button" onClick={props.onDismiss}>
        ×
      </button>
    </div>
  );
}

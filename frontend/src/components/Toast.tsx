import { useEffect } from "react";

interface Props {
  title: string;
  message: string;
  onView: () => void;
  onDismiss: () => void;
}

export default function Toast({ title, message, onView, onDismiss }: Props) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 30000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-50 animate-slide-up">
      <div className="bg-surface border-2 border-violet-500/60 rounded-2xl shadow-2xl shadow-violet-600/30 px-6 py-5 min-w-[340px]">
        <p className="text-base font-bold text-primary">{title}</p>
        <p className="text-sm text-secondary mt-1">{message}</p>
        <div className="flex gap-3 mt-4">
          <button
            onClick={onView}
            className="flex-1 px-4 py-2.5 text-sm font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors shadow-lg shadow-violet-600/25"
          >
            View
          </button>
          <button
            onClick={onDismiss}
            className="px-4 py-2.5 text-sm font-medium bg-control hover:bg-control-hover text-control hover:text-control-hover rounded-xl border border-control transition-colors"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

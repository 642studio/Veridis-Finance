export type NotificationLibrary = "sonner" | "hot-toast" | "sileo" | "toastify";

export interface NotifyPayload {
  title: string;
  description?: string;
}

export type NotifyMessage = string | NotifyPayload;

export interface NotifyOptions {
  id?: string;
  duration?: number;
}

export interface PromiseNotifyMessages<T = unknown> {
  loading: NotifyMessage;
  success: NotifyMessage | ((value: T) => NotifyMessage);
  error: NotifyMessage | ((error: unknown) => NotifyMessage);
}

export interface NotificationApi {
  success: (message: NotifyMessage, options?: NotifyOptions) => string;
  error: (message: NotifyMessage, options?: NotifyOptions) => string;
  info: (message: NotifyMessage, options?: NotifyOptions) => string;
  warning: (message: NotifyMessage, options?: NotifyOptions) => string;
  loading: (message: NotifyMessage, options?: NotifyOptions) => string;
  promise: <T>(
    promiseOrFactory: Promise<T> | (() => Promise<T>),
    messages: PromiseNotifyMessages<T>
  ) => Promise<T>;
  dismiss: (id?: string) => void;
}

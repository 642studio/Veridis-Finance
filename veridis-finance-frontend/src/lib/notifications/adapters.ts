import hotToast from "react-hot-toast";
import { sileo } from "sileo";
import { toast as sonnerToast } from "sonner";
import { toast as toastifyToast } from "react-toastify";

import type {
  NotificationApi,
  NotificationLibrary,
  NotifyMessage,
  NotifyOptions,
  NotifyPayload,
  PromiseNotifyMessages,
} from "@/lib/notifications/types";

function normalizeMessage(message: NotifyMessage): NotifyPayload {
  if (typeof message === "string") {
    return { title: message };
  }

  return {
    title: message.title,
    description: message.description,
  };
}

function stringMessage(message: NotifyMessage): string {
  const payload = normalizeMessage(message);
  return payload.description
    ? `${payload.title}\n${payload.description}`
    : payload.title;
}

function asId(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number") {
    return String(value);
  }

  return "";
}

function executePromise<T>(promiseOrFactory: Promise<T> | (() => Promise<T>)) {
  if (typeof promiseOrFactory === "function") {
    return promiseOrFactory();
  }

  return promiseOrFactory;
}

function resolvePromiseMessage<T>(
  value: NotifyMessage | ((value: T) => NotifyMessage),
  arg: T
): NotifyMessage {
  if (typeof value === "function") {
    return value(arg);
  }

  return value;
}

function resolvePromiseError(
  value: NotifyMessage | ((error: unknown) => NotifyMessage),
  arg: unknown
): NotifyMessage {
  if (typeof value === "function") {
    return value(arg);
  }

  return value;
}

function sonnerAdapter(): NotificationApi {
  return {
    success: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sonnerToast.success(payload.title, {
          id: options?.id,
          duration: options?.duration,
          description: payload.description,
        })
      );
    },
    error: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sonnerToast.error(payload.title, {
          id: options?.id,
          duration: options?.duration,
          description: payload.description,
        })
      );
    },
    info: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sonnerToast.info(payload.title, {
          id: options?.id,
          duration: options?.duration,
          description: payload.description,
        })
      );
    },
    warning: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sonnerToast.warning(payload.title, {
          id: options?.id,
          duration: options?.duration,
          description: payload.description,
        })
      );
    },
    loading: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sonnerToast.loading(payload.title, {
          id: options?.id,
          duration: options?.duration,
          description: payload.description,
        })
      );
    },
    promise: <T>(
      promiseOrFactory: Promise<T> | (() => Promise<T>),
      messages: PromiseNotifyMessages<T>
    ) => {
      const pending = executePromise(promiseOrFactory);
      sonnerToast.promise(pending, {
        loading: stringMessage(messages.loading),
        success: (value) =>
          stringMessage(resolvePromiseMessage(messages.success, value)),
        error: (error) => stringMessage(resolvePromiseError(messages.error, error)),
      });
      return pending;
    },
    dismiss: (id) => {
      sonnerToast.dismiss(id);
    },
  };
}

function hotToastAdapter(): NotificationApi {
  return {
    success: (message, options) =>
      asId(
        hotToast.success(stringMessage(message), {
          id: options?.id,
          duration: options?.duration,
        })
      ),
    error: (message, options) =>
      asId(
        hotToast.error(stringMessage(message), {
          id: options?.id,
          duration: options?.duration,
        })
      ),
    info: (message, options) =>
      asId(
        hotToast(stringMessage(message), {
          id: options?.id,
          duration: options?.duration,
          icon: "ℹ️",
        })
      ),
    warning: (message, options) =>
      asId(
        hotToast(stringMessage(message), {
          id: options?.id,
          duration: options?.duration,
          icon: "⚠️",
        })
      ),
    loading: (message, options) =>
      asId(
        hotToast.loading(stringMessage(message), {
          id: options?.id,
          duration: options?.duration,
        })
      ),
    promise: <T>(
      promiseOrFactory: Promise<T> | (() => Promise<T>),
      messages: PromiseNotifyMessages<T>
    ) => {
      const pending = executePromise(promiseOrFactory);
      hotToast.promise(pending, {
        loading: stringMessage(messages.loading),
        success: (value) =>
          stringMessage(resolvePromiseMessage(messages.success, value)),
        error: (error) => stringMessage(resolvePromiseError(messages.error, error)),
      });
      return pending;
    },
    dismiss: (id) => {
      hotToast.dismiss(id);
    },
  };
}

function sileoAdapter(): NotificationApi {
  return {
    success: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sileo.success({
          title: payload.title,
          description: payload.description,
          duration: options?.duration,
        })
      );
    },
    error: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sileo.error({
          title: payload.title,
          description: payload.description,
          duration: options?.duration,
        })
      );
    },
    info: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sileo.info({
          title: payload.title,
          description: payload.description,
          duration: options?.duration,
        })
      );
    },
    warning: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sileo.warning({
          title: payload.title,
          description: payload.description,
          duration: options?.duration,
        })
      );
    },
    loading: (message, options) => {
      const payload = normalizeMessage(message);
      return asId(
        sileo.show({
          title: payload.title,
          description: payload.description,
          type: "loading",
          duration: options?.duration ?? null,
        })
      );
    },
    promise: <T>(
      promiseOrFactory: Promise<T> | (() => Promise<T>),
      messages: PromiseNotifyMessages<T>
    ) => {
      const pending = executePromise(promiseOrFactory);
      sileo.promise(pending, {
        loading: normalizeMessage(messages.loading),
        success: (value) =>
          normalizeMessage(resolvePromiseMessage(messages.success, value)),
        error: (error) => normalizeMessage(resolvePromiseError(messages.error, error)),
      });
      return pending;
    },
    dismiss: (id) => {
      if (id) {
        sileo.dismiss(id);
        return;
      }

      sileo.clear();
    },
  };
}

function toastifyAdapter(): NotificationApi {
  const baseOptions = (options?: NotifyOptions) => ({
    toastId: options?.id,
    autoClose: options?.duration,
  });

  return {
    success: (message, options) =>
      asId(toastifyToast.success(stringMessage(message), baseOptions(options))),
    error: (message, options) =>
      asId(toastifyToast.error(stringMessage(message), baseOptions(options))),
    info: (message, options) =>
      asId(toastifyToast.info(stringMessage(message), baseOptions(options))),
    warning: (message, options) =>
      asId(toastifyToast.warning(stringMessage(message), baseOptions(options))),
    loading: (message, options) =>
      asId(toastifyToast.loading(stringMessage(message), baseOptions(options))),
    promise: <T>(
      promiseOrFactory: Promise<T> | (() => Promise<T>),
      messages: PromiseNotifyMessages<T>
    ) => {
      const pending = executePromise(promiseOrFactory);
      toastifyToast.promise(pending, {
        pending: stringMessage(messages.loading),
        success: {
          render({ data }) {
            return stringMessage(resolvePromiseMessage(messages.success, data as T));
          },
        },
        error: {
          render({ data }) {
            return stringMessage(resolvePromiseError(messages.error, data));
          },
        },
      });
      return pending;
    },
    dismiss: (id) => {
      toastifyToast.dismiss(id);
    },
  };
}

export function createNotificationApi(library: NotificationLibrary): NotificationApi {
  switch (library) {
    case "hot-toast":
      return hotToastAdapter();
    case "sileo":
      return sileoAdapter();
    case "toastify":
      return toastifyAdapter();
    case "sonner":
    default:
      return sonnerAdapter();
  }
}

type RefreshPayload = {
  ok?: boolean;
  expiresIn?: number;
  error?: string;
};

let refreshPromise: Promise<RefreshPayload> | null = null;
let fetchInterceptorInstalled = false;

function notifyAuthRequired() {
  window.dispatchEvent(new CustomEvent("auth:required"));
}

export async function refreshAccessToken(): Promise<RefreshPayload> {
  if (refreshPromise) return refreshPromise;

  refreshPromise = fetch("/api/auth/refresh", {
    method: "POST",
    credentials: "include",
    cache: "no-store",
  })
    .then(async (response) => {
      const payload = (await response
        .json()
        .catch(() => ({}))) as RefreshPayload;
      if (!response.ok) {
        notifyAuthRequired();
        throw new Error(payload.error || "Authentication refresh failed.");
      }
      return payload;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}

export async function logout() {
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
    });
  } finally {
    notifyAuthRequired();
  }
}

export function installAuthFetchInterceptor() {
  if (fetchInterceptorInstalled) return;
  fetchInterceptorInstalled = true;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const response = await originalFetch(input, init);
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;

    if (
      response.status === 401 &&
      new URL(url, window.location.origin).pathname.startsWith("/api")
    ) {
      notifyAuthRequired();
    }

    return response;
  };
}

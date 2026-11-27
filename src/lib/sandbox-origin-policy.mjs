const netlifyOrigin = "https://deploy-preview-12--mcpos-dashboard.netlify.app";
const vercelOrigin = "https://mcpos-dashboard.vercel.app";

export function hostedSandboxOriginAllowed(env, origin) {
  return (origin === netlifyOrigin && env.MCPOS_BUILD_PREVIEW_ORIGIN === netlifyOrigin) ||
    (origin === vercelOrigin && env.VERCEL_ENV === "production" &&
      !env.MCPOS_BUILD_PREVIEW_ORIGIN && env.MCPOS_BILLING_ENABLED === "true");
}

export function sandboxOriginEnabled(env, origin) {
  if (env.MCPOS_BILLING_ENABLED === "false") return false;
  return hostedSandboxOriginAllowed(env, origin) ||
    (origin?.startsWith("http://127.0.0.1:") === true && env.MCPOS_BILLING_ENABLED === "true");
}

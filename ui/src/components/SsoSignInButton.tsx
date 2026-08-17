import { useMutation } from "@tanstack/react-query";
import { authApi } from "../api/auth";
import { navigateTopLevel } from "../lib/browserNavigation";
import { Button } from "@/components/ui/button";

/**
 * Company SSO entry point, shared by the sign-in page and the invite landing
 * page. Both need it: an invite is the first thing a new colleague opens, and
 * without SSO there it is a dead end — they have no email/password account to
 * sign in with.
 *
 * Shared rather than copied so the label, pending copy, and redirect handling
 * exist once, and so each upstream page carries a one-line render instead of a
 * mutation plus a button plus a divider.
 */
export function SsoSignInButton(props: {
  /** Where the provider should return to — an invite path, or "/" .*/
  callbackURL: string;
  disabled?: boolean;
  onError: (message: string) => void;
  /** Runs before the redirect, e.g. to remember a pending invite token. */
  beforeStart?: () => void;
  variant?: "default" | "outline";
}) {
  const mutation = useMutation({
    mutationFn: () => {
      props.beforeStart?.();
      return authApi.signInOidc({ callbackURL: props.callbackURL });
    },
    onSuccess: (redirectUrl) => navigateTopLevel(redirectUrl),
    onError: (err) => {
      props.onError(err instanceof Error ? err.message : "SSO sign-in failed");
    },
  });

  return (
    <Button
      type="button"
      variant={props.variant ?? "default"}
      className="w-full"
      disabled={props.disabled || mutation.isPending}
      onClick={() => mutation.mutate()}
    >
      {mutation.isPending ? "Redirecting…" : "Continue with Waffo SSO"}
    </Button>
  );
}

/**
 * The "or use email" rule shown between SSO and the email form.
 *
 * The colours are props because the two pages that show it do not share a
 * palette: the sign-in page follows the app theme, while the invite page is a
 * standalone dark page using explicit zinc. Copying the markup to serve both
 * would leave the label duplicated, which is the thing worth sharing.
 */
export function SsoDivider(props: { lineClass?: string; labelClass?: string }) {
  const line = `h-px flex-1 ${props.lineClass ?? "bg-border"}`;
  return (
    <div className={`flex items-center gap-3 text-xs ${props.labelClass ?? "text-muted-foreground"}`}>
      <div className={line} />
      <span>or use email</span>
      <div className={line} />
    </div>
  );
}

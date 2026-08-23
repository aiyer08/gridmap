"use client";

import { useState } from "react";
import { Check, Mail } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card, CardBody, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn, focusRing } from "@/components/ui/cn";
import { signInWithOtp, signOut } from "@/lib/track/supabaseClient";
import { useSession } from "./useSession";

type Status = "idle" | "sending" | "sent" | "error";

/**
 * Optional sign-in. The app is fully usable without it, so this is framed as
 * "keep your history if you switch devices" rather than a gate.
 */
export function SignInCard({ className }: { className?: string }) {
  const { session, ready, available } = useSession();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [message, setMessage] = useState<string | null>(null);

  if (!available) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Your progress is saved on this device</CardTitle>
        </CardHeader>
        <CardBody className="text-sm text-ink-3">
          Everything you log stays in this browser — no account, no email, nothing
          sent anywhere. Sign-in across devices isn&apos;t switched on for this
          deployment.
        </CardBody>
      </Card>
    );
  }

  if (!ready) {
    return (
      <Card className={className}>
        <CardBody className="h-24 animate-pulse" />
      </Card>
    );
  }

  if (session) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Signed in as {session.email ?? "you"}</CardTitle>
        </CardHeader>
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-3">
            Your impact history follows you to any device you sign in on.
          </p>
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardBody>
      </Card>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("sending");
    const result = await signInWithOtp(email);
    if (result.ok) {
      setStatus("sent");
      setMessage(null);
    } else {
      setStatus("error");
      setMessage(result.error ?? "Something went wrong. Try again in a moment.");
    }
  }

  if (status === "sent") {
    return (
      <Card className={className}>
        <CardBody className="flex items-start gap-3">
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-i1-soft text-i1-text">
            <Check className="size-4" />
          </span>
          <div>
            <p className="font-medium">Check your email</p>
            <p className="mt-1 text-sm text-ink-3">
              We sent a sign-in link to {email}. Opening it brings your saved
              progress with you — nothing you&apos;ve already logged is lost.
            </p>
          </div>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Keep your progress across devices</CardTitle>
      </CardHeader>
      <CardBody>
        <p className="text-sm text-ink-3">
          Optional. Your history is already saved in this browser — signing in
          just carries it to your phone too. No password, we email you a link.
        </p>
        <form onSubmit={submit} className="mt-4 flex flex-wrap items-center gap-2">
          <label htmlFor="signin-email" className="sr-only">
            Email address
          </label>
          <div className="relative min-w-[12rem] flex-1">
            <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
            <input
              id="signin-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (status === "error") setStatus("idle");
              }}
              placeholder="you@example.com"
              className={cn(
                "h-10 w-full rounded-lg border border-hairline bg-surface pl-9 pr-3 text-sm",
                "placeholder:text-ink-4",
                focusRing,
              )}
            />
          </div>
          <Button type="submit" variant="primary" loading={status === "sending"}>
            Email me a link
          </Button>
        </form>
        {status === "error" && message ? (
          <p className="mt-2 text-sm text-danger" role="alert">
            {message}
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

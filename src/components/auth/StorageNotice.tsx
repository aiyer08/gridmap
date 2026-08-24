import { Lock } from "lucide-react";
import { Card, CardBody } from "@/components/ui/Card";

/**
 * GridMap has no accounts, and that's a feature rather than a gap.
 *
 * Your impact history lives in this browser and is never sent anywhere, which
 * means there's nothing to sign up for, no email to hand over, and no database
 * of household energy habits sitting somewhere waiting to leak.
 */
export function StorageNotice({ className }: { className?: string }) {
  return (
    <Card variant="quiet" className={className}>
      <CardBody className="flex items-start gap-3">
        <span
          className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-3 text-ink-3"
          aria-hidden
        >
          <Lock className="size-4" />
        </span>
        <div>
          <p className="text-sm font-medium">Your progress stays on this device</p>
          <p className="mt-1 text-sm text-ink-3">
            No account, no email, nothing uploaded. Everything you log is kept in
            this browser only — so clearing your browser data clears your history
            too, and opening GridMap on your phone starts a fresh tally.
          </p>
        </div>
      </CardBody>
    </Card>
  );
}

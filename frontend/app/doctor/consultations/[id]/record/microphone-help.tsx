import { Mic, MicOff, Monitor, RotateCw, ShieldAlert, Smartphone } from "lucide-react";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import type { RecorderStatus } from "@/hooks/use-chunked-recorder";

type ProblemStatus = Extract<RecorderStatus, "requesting" | "blocked" | "no-microphone" | "mic-busy" | "insecure" | "unsupported">;

export function isMicrophoneProblem(status: RecorderStatus): status is ProblemStatus {
  return ["requesting", "blocked", "no-microphone", "mic-busy", "insecure", "unsupported"].includes(status);
}

// One way per browser: the doctor follows the one they use.
const BROWSERS = [
  {
    icon: Monitor,
    browser: "Chrome or Edge on a computer",
    text: "Click the icon on the left of the address bar, turn on Microphone, then press Try again.",
  },
  {
    icon: Smartphone,
    browser: "Chrome on Android",
    text: "Tap the icon on the left of the address bar, tap Permissions, allow Microphone, then press Try again.",
  },
  {
    icon: Smartphone,
    browser: "Safari on iPhone or iPad",
    text: "Tap aA in the address bar, tap Website Settings, set Microphone to Allow, then press Try again.",
  },
];

const PROBLEMS: Record<Exclude<ProblemStatus, "requesting" | "blocked">, { title: string; text: string }> = {
  "no-microphone": {
    title: "No microphone found",
    text: "Connect a microphone or a headset with a microphone, then press Try again.",
  },
  "mic-busy": {
    title: "The microphone cannot be used",
    text: "Another app may be using it. Close calls or other recording apps, then press Try again.",
  },
  insecure: {
    title: "The microphone needs a secure link",
    text: "Browsers allow the microphone only on https:// pages or on localhost. Open MediAssist AI with its https:// address.",
  },
  unsupported: {
    title: "This browser cannot record",
    text: "Please open MediAssist AI in the latest Chrome, Edge or Firefox.",
  },
};

// Shown instead of the recorder while the microphone cannot be used.
export function MicrophoneHelp({ status, onRetry }: { status: ProblemStatus; onRetry: () => void }) {
  if (status === "requesting") {
    return (
      <Card>
        <IconTile tone="mint">
          <Mic aria-hidden="true" className="size-6" />
        </IconTile>
        <h2 className="mt-5 font-display text-xl font-bold tracking-tight">Allow the microphone</h2>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          Your browser is asking to use the microphone. Choose Allow to start recording.
        </p>
        <p className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
          <Spinner className="size-4" label="Waiting for the microphone" />
          Waiting for your answer
        </p>
      </Card>
    );
  }

  if (status === "blocked") {
    return (
      <Card>
        <IconTile tone="peach">
          <MicOff aria-hidden="true" className="size-6" />
        </IconTile>
        <h2 className="mt-5 font-display text-xl font-bold tracking-tight">The microphone is blocked</h2>
        <p className="mt-1.5 leading-relaxed text-muted-foreground">
          MediAssist AI needs the microphone to record the consultation. Allow it in your browser:
        </p>
        <ul className="mt-5 space-y-3">
          {BROWSERS.map(({ icon: Icon, browser, text }) => (
            <li key={browser} className="flex gap-3">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Icon aria-hidden="true" className="size-3.5" />
              </span>
              <p className="min-w-0 leading-relaxed">
                <span className="font-semibold">{browser}:</span> <span className="text-muted-foreground">{text}</span>
              </p>
            </li>
          ))}
        </ul>
        <RetryButton onRetry={onRetry} />
      </Card>
    );
  }

  const problem = PROBLEMS[status];
  return (
    <Card>
      <IconTile tone="peach">
        <ShieldAlert aria-hidden="true" className="size-6" />
      </IconTile>
      <h2 className="mt-5 font-display text-xl font-bold tracking-tight">{problem.title}</h2>
      <p className="mt-1.5 leading-relaxed text-muted-foreground">{problem.text}</p>
      {status !== "insecure" && status !== "unsupported" && <RetryButton onRetry={onRetry} />}
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div role="region" aria-label="Microphone" className="rounded-[1.5rem] border bg-card p-6 sm:p-8">
      {children}
    </div>
  );
}

function IconTile({ tone, children }: { tone: "mint" | "peach"; children: React.ReactNode }) {
  const toneClass = tone === "mint" ? "bg-mint text-mint-foreground" : "bg-peach text-peach-foreground";
  return <div className={`flex size-14 items-center justify-center rounded-2xl ${toneClass}`}>{children}</div>;
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button size="lg" onClick={onRetry} className="mt-7 w-full">
      <RotateCw aria-hidden="true" data-icon="inline-start" />
      Try again
    </Button>
  );
}

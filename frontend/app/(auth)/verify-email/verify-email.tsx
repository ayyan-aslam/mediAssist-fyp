"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, CircleCheck, MailCheck } from "lucide-react";
import { toast } from "sonner";
import { AuthHeading } from "@/components/shared/auth-heading";
import { Spinner } from "@/components/shared/spinner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api/client";
import {
  firebaseCurrentEmail,
  firebaseErrorMessage,
  firebaseSendVerificationEmail,
  verificationEmailResult,
} from "@/lib/firebase";

// Wait before the user can ask for another email (Firebase limits how often it sends them).
const RESEND_WAIT_SECONDS = 60;
// How often to check if the email is verified, while this tab is open.
const CHECK_EVERY_MS = 5000;

type SendState = "sending" | "sent" | "failed";

export function VerifyEmail() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { loginAfterVerification } = useAuth();
  const [email, setEmail] = useState(searchParams.get("email"));
  const [sendState, setSendState] = useState<SendState>("sending");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [resending, setResending] = useState(false);
  const checking = useRef(false);
  const done = useRef(false);

  useEffect(() => {
    if (email) return;
    firebaseCurrentEmail().then(setEmail);
  }, [email]);

  // The email is sent in the background after sign-up. Show when it is sent, or if it failed.
  useEffect(() => {
    verificationEmailResult().then((sent) => {
      setSendState(sent ? "sent" : "failed");
      if (sent) setSecondsLeft(RESEND_WAIT_SECONDS);
    });
  }, []);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [secondsLeft]);

  // When the user verifies the email (in another tab or on the phone), log in and open the home page.
  useEffect(() => {
    async function check() {
      if (checking.current || done.current || document.visibilityState !== "visible") return;
      checking.current = true;
      try {
        await verificationEmailResult();
        const user = await loginAfterVerification();
        if (user) {
          done.current = true;
          toast.success("Your email is verified. Welcome to MediAssist AI!");
          router.replace(`/${user.role}`);
        }
      } catch (err) {
        // For example ACCOUNT_SUSPENDED. Stop checking and let the user go to the login page.
        if (err instanceof ApiError) {
          done.current = true;
          toast.error(err.message);
        }
      } finally {
        checking.current = false;
      }
    }

    const timer = setInterval(check, CHECK_EVERY_MS);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [loginAfterVerification, router]);

  async function resend() {
    setResending(true);
    try {
      const sent = await firebaseSendVerificationEmail();
      if (sent) {
        toast.success(email ? `We sent a new email to ${email}.` : "We sent a new verification email.");
        setSendState("sent");
        setSecondsLeft(RESEND_WAIT_SECONDS);
      } else {
        toast.error("Please log in, then press “Send the email again” on the login page.");
      }
    } catch (err) {
      toast.error(firebaseErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <AuthHeading icon={MailCheck} title="Please check your email">
        <p>
          Your account is ready. A verification link is on its way to{" "}
          {email ? <span className="font-medium text-foreground">{email}</span> : "your email"}. Open the link, and this
          page opens your home page by itself.
        </p>
      </AuthHeading>

      <div aria-live="polite" className="mb-6 flex items-center gap-2 text-sm">
        {sendState === "sending" && (
          <>
            <Spinner className="size-4" label="Sending" />
            <span className="text-muted-foreground">Sending the email…</span>
          </>
        )}
        {sendState === "sent" && (
          <>
            <CircleCheck aria-hidden="true" className="size-4 text-success" />
            <span className="text-muted-foreground">Email sent. Waiting for you to open the link…</span>
          </>
        )}
        {sendState === "failed" && (
          <>
            <CircleAlert aria-hidden="true" className="size-4 text-destructive" />
            <span className="text-destructive">The email could not be sent. Please press “Send the email again”.</span>
          </>
        )}
      </div>

      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full"
          onClick={resend}
          disabled={resending || sendState === "sending" || secondsLeft > 0}
        >
          {resending && <Spinner className="size-4 text-current" label="Sending" />}
          {secondsLeft > 0 ? `Send the email again in ${secondsLeft} s` : "Send the email again"}
        </Button>
        <Button asChild variant="ghost" size="lg" className="w-full">
          <Link href="/login">Go to login</Link>
        </Button>
      </div>

      <div className="mt-8 rounded-xl bg-muted/60 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Can’t find the email?</p>
        <p className="mt-1">Check your spam or junk folder. The email comes from MediAssist AI through Firebase.</p>
      </div>
    </>
  );
}

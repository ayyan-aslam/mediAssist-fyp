"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, CircleCheck, MailWarning, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { AuthHeading } from "@/components/shared/auth-heading";
import { describedBy, FormField } from "@/components/shared/form-field";
import { PasswordInput } from "@/components/shared/password-input";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api/client";
import { firebaseErrorMessage, firebaseSendVerificationEmail, isFirebaseError } from "@/lib/firebase";

const schema = z.object({
  email: z.string().trim().min(1, "Please enter your email.").pipe(z.email("Please enter a valid email address.")),
  password: z.string().min(1, "Please enter your password."),
});

type Values = z.infer<typeof schema>;

// What the alert above the form shows after a failed login.
type LoginProblem =
  | { kind: "unverified"; email: string }
  | { kind: "suspended"; message: string }
  | { kind: "error"; message: string };

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, loginAfterVerification } = useAuth();
  const [problem, setProblem] = useState<LoginProblem | null>(null);
  const [resending, setResending] = useState(false);
  const justVerified = searchParams.get("verified") === "1";

  // Back from the Firebase verification page: log in at once if the user signed up on this device.
  useEffect(() => {
    if (!justVerified) return;
    loginAfterVerification()
      .then((user) => user && router.replace(`/${user.role}`))
      .catch(() => {});
  }, [justVerified, loginAfterVerification, router]);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { email: "", password: "" } });

  async function onSubmit({ email, password }: Values) {
    setProblem(null);
    try {
      const user = await login(email.trim(), password);
      // Go back to the page the guard sent the user away from, if it is in the user's own area.
      const next = searchParams.get("next");
      router.replace(next?.startsWith(`/${user.role}`) ? next : `/${user.role}`);
    } catch (err) {
      if (err instanceof ApiError && err.code === "EMAIL_NOT_VERIFIED") {
        setProblem({ kind: "unverified", email: email.trim() });
      } else if (err instanceof ApiError && err.code === "ACCOUNT_SUSPENDED") {
        setProblem({ kind: "suspended", message: err.message });
      } else if (isFirebaseError(err) && err.code === "auth/user-disabled") {
        setProblem({ kind: "suspended", message: firebaseErrorMessage(err) });
      } else {
        setProblem({ kind: "error", message: err instanceof ApiError ? err.message : firebaseErrorMessage(err) });
      }
    }
  }

  async function resendVerification() {
    if (problem?.kind !== "unverified") return;
    setResending(true);
    try {
      const sent = await firebaseSendVerificationEmail();
      if (sent) toast.success(`We sent a new verification email to ${problem.email}.`);
      else toast.error("Please log in again, then press “Send the email again”.");
    } catch (err) {
      toast.error(firebaseErrorMessage(err));
    } finally {
      setResending(false);
    }
  }

  return (
    <>
      <AuthHeading title="Welcome back">Log in to your MediAssist AI account.</AuthHeading>

      {justVerified && !problem && (
        <Alert className="mb-6 border-primary/25 bg-mint *:[svg]:text-mint-foreground">
          <CircleCheck aria-hidden="true" />
          <AlertTitle>Your email is verified</AlertTitle>
          <AlertDescription>You can log in now.</AlertDescription>
        </Alert>
      )}

      {problem?.kind === "unverified" && (
        <Alert className="mb-6 border-highlight/60 bg-peach *:[svg]:text-peach-foreground">
          <MailWarning aria-hidden="true" />
          <AlertTitle>Please verify your email first</AlertTitle>
          <AlertDescription>
            <p>
              Open the link we sent to <span className="font-medium">{problem.email}</span>, then log in again. Check the
              spam folder too.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={resendVerification}
              disabled={resending}
            >
              {resending && <Spinner className="size-3.5 text-current" label="Sending" />}
              Send the email again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {problem?.kind === "suspended" && (
        <Alert variant="destructive" className="mb-6">
          <ShieldAlert aria-hidden="true" />
          <AlertTitle>Account suspended</AlertTitle>
          <AlertDescription>{problem.message}</AlertDescription>
        </Alert>
      )}

      {problem?.kind === "error" && (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{problem.message}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        <FormField id="email" label="Email" error={errors.email?.message}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="sara@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={describedBy("email")}
            {...register("email")}
          />
        </FormField>

        <FormField
          id="password"
          label="Password"
          error={errors.password?.message}
          labelAside={
            <Link
              href="/forgot-password"
              className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          }
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            aria-describedby={describedBy("password")}
            {...register("password")}
          />
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner className="size-4 text-current" label="Logging in" />}
          {isSubmitting ? "Logging in…" : "Log in"}
        </Button>
      </form>

      <p className="mt-8 text-center text-sm text-muted-foreground">
        New to MediAssist AI?{" "}
        <Link href="/signup/doctor" className="font-medium text-primary underline-offset-4 hover:underline">
          Create a doctor account
        </Link>
      </p>
    </>
  );
}

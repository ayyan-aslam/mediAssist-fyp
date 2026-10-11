"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CircleAlert, CircleCheck, KeyRound, LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { AuthHeading } from "@/components/shared/auth-heading";
import { describedBy, FormField } from "@/components/shared/form-field";
import { PasswordInput } from "@/components/shared/password-input";
import { RuleList } from "@/components/shared/rule-list";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { ApiError } from "@/lib/api/client";
import {
  firebaseApplyEmailVerification,
  firebaseCheckPasswordResetCode,
  firebaseConfirmPasswordReset,
  firebaseErrorMessage,
} from "@/lib/firebase";
import { PASSWORD_HINT, passwordRules, passwordSchema } from "@/lib/password";

export function EmailAction() {
  const searchParams = useSearchParams();
  const mode = searchParams.get("mode");
  const oobCode = searchParams.get("oobCode") ?? "";

  if (mode === "verifyEmail" && oobCode) return <VerifyEmailAction oobCode={oobCode} />;
  if (mode === "resetPassword" && oobCode) return <ResetPasswordAction oobCode={oobCode} />;
  return <LinkProblem message="This link is not valid. Please check that you opened the full link from the email." />;
}

function Working() {
  return (
    <div className="flex justify-center py-16">
      <Spinner className="size-8" label="Checking the link" />
    </div>
  );
}

function LinkProblem({ message }: { message: string }) {
  return (
    <>
      <AuthHeading icon={LinkIcon} title="This link does not work">
        {message}
      </AuthHeading>
      <Button asChild size="lg" className="w-full">
        <Link href="/login">Go to login</Link>
      </Button>
    </>
  );
}

// Email verification: confirm the link, then log in at once if the user signed up on this device.
function VerifyEmailAction({ oobCode }: { oobCode: string }) {
  const router = useRouter();
  const { loginAfterVerification } = useAuth();
  const [state, setState] = useState<"working" | "verified" | { error: string }>("working");
  const started = useRef(false);

  useEffect(() => {
    // A link code works only once, so do not run this twice (React runs effects twice in development).
    if (started.current) return;
    started.current = true;

    (async () => {
      let linkError: unknown = null;
      try {
        await firebaseApplyEmailVerification(oobCode);
      } catch (err) {
        linkError = err;
      }
      // Even if the link was already used, the email may be verified: try to log in anyway.
      try {
        const user = await loginAfterVerification();
        if (user) {
          toast.success("Your email is verified. Welcome to MediAssist AI!");
          router.replace(`/${user.role}`);
          return;
        }
      } catch (err) {
        if (err instanceof ApiError) {
          setState({ error: err.message });
          return;
        }
      }
      setState(linkError ? { error: firebaseErrorMessage(linkError) } : "verified");
    })();
  }, [oobCode, loginAfterVerification, router]);

  if (state === "working") return <Working />;

  if (state === "verified") {
    // Opened on another device or browser: there is no session here, so the user logs in once.
    return (
      <>
        <AuthHeading icon={CircleCheck} title="Your email is verified">
          You can log in to your account now.
        </AuthHeading>
        <Button asChild size="lg" className="w-full">
          <Link href="/login">Log in</Link>
        </Button>
      </>
    );
  }

  return <LinkProblem message={state.error} />;
}

const resetSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Please type your password again."),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "The passwords do not match.",
    when: (payload) => !payload.issues.some((issue) => issue.path?.[0] === "confirmPassword"),
  });

type ResetValues = z.infer<typeof resetSchema>;

// Password reset: the same password rules as sign-up, then log in with the new password.
function ResetPasswordAction({ oobCode }: { oobCode: string }) {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    control,
    trigger,
    getFieldState,
    formState: { errors, isSubmitting },
  } = useForm<ResetValues>({
    resolver: zodResolver(resetSchema),
    mode: "onTouched",
    defaultValues: { password: "", confirmPassword: "" },
  });
  const [password, confirmPassword] = useWatch({ control, name: ["password", "confirmPassword"] });
  const passwordField = register("password", {
    onChange: () => {
      if (getFieldState("confirmPassword").isTouched) trigger("confirmPassword");
    },
  });

  useEffect(() => {
    firebaseCheckPasswordResetCode(oobCode)
      .then(setEmail)
      .catch((err) => setLinkError(firebaseErrorMessage(err)));
  }, [oobCode]);

  async function onSubmit(values: ResetValues) {
    if (!email) return;
    setFormError(null);
    try {
      await firebaseConfirmPasswordReset(oobCode, values.password);
    } catch (err) {
      setFormError(firebaseErrorMessage(err));
      return;
    }
    try {
      const user = await login(email, values.password);
      toast.success("Your password is changed.");
      router.replace(`/${user.role}`);
    } catch {
      // For example the email is not verified yet: the login page explains what to do.
      toast.success("Your password is changed. Please log in.");
      router.replace("/login");
    }
  }

  if (linkError) return <LinkProblem message={linkError} />;
  if (!email) return <Working />;

  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  return (
    <>
      <AuthHeading icon={KeyRound} title="Set a new password">
        <p>
          For <span className="font-medium text-foreground">{email}</span>. {PASSWORD_HINT}
        </p>
      </AuthHeading>

      {formError && (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{formError}</AlertDescription>
        </Alert>
      )}

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="space-y-5">
        {/* Lets password managers save the new password for the right account. */}
        <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />

        <FormField
          id="password"
          label="New password"
          error={errors.password?.message}
          hint={<RuleList rules={passwordRules(password)} />}
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            aria-invalid={!!errors.password}
            aria-describedby={describedBy("password")}
            {...passwordField}
          />
        </FormField>

        <FormField
          id="confirmPassword"
          label="Confirm new password"
          error={errors.confirmPassword?.message}
          hint={passwordsMatch ? <RuleList rules={[{ label: "Passwords match", met: true }]} /> : undefined}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={describedBy("confirmPassword")}
            {...register("confirmPassword")}
          />
        </FormField>

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner className="size-4 text-current" label="Saving" />}
          {isSubmitting ? "Saving…" : "Save new password"}
        </Button>
      </form>
    </>
  );
}

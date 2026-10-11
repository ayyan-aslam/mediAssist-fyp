"use client";

import { useState } from "react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, CircleAlert, KeyRound, MailCheck } from "lucide-react";
import { z } from "zod";
import { AuthHeading } from "@/components/shared/auth-heading";
import { describedBy, FormField } from "@/components/shared/form-field";
import { Spinner } from "@/components/shared/spinner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { firebaseErrorMessage, firebaseSendPasswordReset, isFirebaseError } from "@/lib/firebase";

const schema = z.object({
  email: z.string().trim().min(1, "Please enter your email.").pipe(z.email("Please enter a valid email address.")),
});

type Values = z.infer<typeof schema>;

export function ForgotPasswordForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema), mode: "onTouched", defaultValues: { email: "" } });

  async function onSubmit({ email }: Values) {
    setFormError(null);
    try {
      await firebaseSendPasswordReset(email.trim());
    } catch (err) {
      // Do not tell whether an account exists for this email.
      if (!(isFirebaseError(err) && err.code === "auth/user-not-found")) {
        setFormError(firebaseErrorMessage(err));
        return;
      }
    }
    setSentTo(email.trim());
  }

  const backLink = (
    <Link
      href="/login"
      className="mb-8 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft aria-hidden="true" className="size-4" />
      Back to login
    </Link>
  );

  if (sentTo) {
    return (
      <>
        {backLink}
        <AuthHeading icon={MailCheck} title="Check your email">
          <p>
            If an account exists for <span className="font-medium text-foreground">{sentTo}</span>, we sent a link to set a
            new password. The link works for a short time only.
          </p>
        </AuthHeading>
        <div className="space-y-3">
          <Button asChild size="lg" className="w-full">
            <Link href="/login">Back to login</Link>
          </Button>
          <Button type="button" variant="ghost" size="lg" className="w-full" onClick={() => setSentTo(null)}>
            Use a different email
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {backLink}
      <AuthHeading icon={KeyRound} title="Forgot your password?">
        Enter the email of your account. We will send you a link to set a new password.
      </AuthHeading>

      {formError && (
        <Alert variant="destructive" className="mb-6">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{formError}</AlertDescription>
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

        <Button type="submit" size="lg" className="w-full" disabled={isSubmitting}>
          {isSubmitting && <Spinner className="size-4 text-current" label="Sending" />}
          {isSubmitting ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </>
  );
}

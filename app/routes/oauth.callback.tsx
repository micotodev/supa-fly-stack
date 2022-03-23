import { useEffect } from "react";
import {
  ActionFunction,
  json,
  LoaderFunction,
  redirect,
  useActionData,
  useSearchParams,
} from "remix";
import { useSubmit } from "remix";
import { getFormData } from "remix-params-helper";
import { z } from "zod";
import { supabaseClient } from "~/database/supabase.client";
import { getUserByEmail } from "~/models/user.server";
import { creatOAuthUser } from "~/services/auth.server";
import { commitUserSession, getUserSession } from "~/services/session.server";
import { mapSession } from "~/utils/session-mapper";

const ActionSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.string(),
  userId: z.string(),
  email: z.string().email(),
  redirectTo: z.string().optional(),
});

// imagine a user go back after OAuth login success or type this URL
// we don't want him to fall in a black hole 👽
export const loader: LoaderFunction = async ({ request }) => {
  const userSession = await getUserSession(request);

  if (userSession) return redirect("/notes");

  return json({});
};

interface ActionData {
  message?: string;
}

export const action: ActionFunction = async ({ request }) => {
  const form = await getFormData(request, ActionSchema);

  if (!form.success) {
    return json<ActionData>(
      {
        message: "invalid-token",
      },
      { status: 400 }
    );
  }

  const { redirectTo = "/notes", ...userSession } = form.data;

  // user have un account, skip creation part and just commit session
  if (await getUserByEmail(userSession.email)) {
    return redirect(redirectTo, {
      headers: {
        "Set-Cookie": await commitUserSession(request, {
          userSession,
        }),
      },
    });
  }

  // first time sign in, let's create a brand new User row in supabase
  const createUserError = await creatOAuthUser(
    userSession.userId,
    userSession.email
  );

  if (createUserError) {
    return json<ActionData>(
      {
        message: "create-user-error",
      },
      { status: 500 }
    );
  }

  return redirect(redirectTo, {
    headers: {
      "Set-Cookie": await commitUserSession(request, {
        userSession,
      }),
    },
  });
};

export default function LoginCallback() {
  const error = useActionData() as ActionData;
  const submit = useSubmit();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/notes";

  useEffect(() => {
    const { data: authListener } = supabaseClient.auth.onAuthStateChange(
      (event, authSession) => {
        if (event === "SIGNED_IN") {
          // supabase auth listener give us a user session
          // but we can't use it directly, client-side, because we can't access sessionStorage from here
          // so, we map what we need, and let's back-end to the work
          const userSession = mapSession(authSession!);
          const formData = new FormData();

          for (const [key, value] of Object.entries(userSession)) {
            formData.append(key, value);
          }

          formData.append("redirectTo", redirectTo);

          submit(formData, { method: "post" });
        }
      }
    );

    return () => {
      // prevent memory leak. Listener stays alive 👨‍🎤
      authListener?.unsubscribe();
    };
  }, [submit, redirectTo]);

  return error ? <div>{error.message}</div> : null;
}
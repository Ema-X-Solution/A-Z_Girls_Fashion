import { useEffect, useState } from "react";
import { api, useSession } from "./api";
import { LoginPage } from "./features/auth/LoginPage";
import { notify, readableError, Toasts } from "./app/notifications";
import { Loading } from "./components/application/Primitives";
import { Shell } from "./app/Shell";

export default function App() {
  const [ready, setReady] = useState(false),
    user = useSession((s) => s.user),
    setUser = useSession((s) => s.setUser);
  useEffect(() => {
    api("/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => {})
      .finally(() => setReady(true));
  }, [setUser]);
  return (
    <>
      <Toasts />
      {!ready ? <Loading /> : user ? <Shell /> : (
        <LoginPage onError={(error) => notify(readableError(error), true)} />
      )}
    </>
  );
}

import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ArrowUpLeft, Eye, EyeOff } from "lucide-react";
import { api, post, useSession, type User } from "../../api";
import { ar } from "../../i18n";
import { Button } from "../../components/ui/button";
import { BrandLogo } from "../shared/BrandLogo";
import { Field } from "../../components/application/Primitives";

type LoginPageProps = {
  onError: (error: unknown) => void;
};

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});
export function LoginPage({ onError }: LoginPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const {
      register,
      handleSubmit,
      formState: { errors, isSubmitting },
    } = useForm<z.infer<typeof loginSchema>>({
      resolver: zodResolver(loginSchema),
    }),
    setUser = useSession((s) => s.setUser);
  return (
    <main className="login">
      <section className="login-brand">
        <BrandLogo className="login-store-logo" />
        <div className="gold-rule" />
        <h1>GIRLS FASHION</h1>
        <p>{ar.tagline}</p>
        <span className="login-caption">مساحة واحدة لكل تفاصيل متجرك</span>
      </section>
      <section className="login-panel">
        <div className="eyebrow">مرحباً بك من جديد</div>
        <h2>إدارة متجرك تبدأ من هنا</h2>
        <p>سجّل الدخول إلى حسابك للمتابعة</p>
        <form
          onSubmit={handleSubmit(async (values) => {
            try {
              await post("/auth/login", values);
              const { data } = await api<{ data: User }>("/auth/me");
              setUser(data);
              navigate("/", { replace: true });
            } catch (e) {
              onError(e);
            }
          })}
        >
          <Field label={ar.email}>
            <input
              type="email"
              autoComplete="username"
              dir="ltr"
              {...register("email")}
              aria-invalid={!!errors.email}
            />
          </Field>
          <Field label={ar.password}>
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                {...register("password")}
                aria-invalid={!!errors.password}
              />
              <button
                type="button"
                className="password-toggle"
                aria-label={showPassword ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
                onClick={() => setShowPassword((value) => !value)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </div>
          </Field>
          <Button disabled={isSubmitting} className="full">
            {isSubmitting ? ar.loading : "تسجيل الدخول"}
            <ArrowUpLeft size={18} />
          </Button>
        </form>
        <small>نظام إدارة المبيعات والمخزون • A&Z Girls Fashion</small>
      </section>
    </main>
  );
}

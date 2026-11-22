import { validationMessage } from "./arabicFormValidation";
import { useState } from "react";
import { CircleAlert, Eye, EyeOff } from "lucide-react";
import { ar } from "../../i18n";
import { Button } from "../ui/button";
import { Field } from "./Primitives";
import { type Row } from "../../app/types";

export type FieldSpec = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  default?: string;
  min?: number;
  max?: number;
  step?: string;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  hint?: string;
};

export function EntryForm({
  fields,
  submit,
  busy,
  initial = {},
  error = "",
}: {
  fields: FieldSpec[];
  submit: (value: Row) => void;
  busy: boolean;
  initial?: Row;
  error?: string;
}) {
  const [visiblePasswords, setVisiblePasswords] = useState<
    Record<string, boolean>
  >({});
  const [formError, setFormError] = useState("");
  return (
    <form
      className="entry-form"
      onInput={() => setFormError("")}
      onInvalid={(e) => {
        e.preventDefault();
        const input = e.target as HTMLInputElement;
        const label =
          fields.find((field) => field.key === input.name)?.label ?? "الحقل";
        setFormError(validationMessage(input, label));
        input.focus();
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(e.currentTarget));
        if (
          typeof data.password === "string" &&
          data.password.length > 0 &&
          data.password.length < 8
        ) {
          setFormError("كلمة المرور يجب أن تكون 8 أحرف على الأقل");
          return;
        }
        setFormError("");
        submit(data);
      }}
    >
      <div className="form-grid">
        {fields.map((f) => (
          <Field key={f.key} label={f.label} hint={f.hint}>
            {f.options ? (
              <select
                name={f.key}
                required={f.required !== false}
                defaultValue={initial[f.key] ?? f.default ?? ""}
              >
                <option value="">اختر...</option>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : f.type === "textarea" ? (
              <textarea
                name={f.key}
                minLength={f.minLength}
                maxLength={f.maxLength}
                required={f.required !== false}
                defaultValue={initial[f.key] ?? f.default}
              />
            ) : f.type === "checkbox" ? (
              <input
                name={f.key}
                type="checkbox"
                role="switch"
                value="true"
                defaultChecked={String(initial[f.key] ?? f.default) === "true"}
              />
            ) : f.type === "password" ? (
              <div className="password-field">
                <input
                  name={f.key}
                  type={visiblePasswords[f.key] ? "text" : "password"}
                  required={f.required !== false}
                  defaultValue={initial[f.key] ?? f.default}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={
                    visiblePasswords[f.key]
                      ? "إخفاء كلمة المرور"
                      : "إظهار كلمة المرور"
                  }
                  onClick={() =>
                    setVisiblePasswords((old) => ({
                      ...old,
                      [f.key]: !old[f.key],
                    }))
                  }
                >
                  {visiblePasswords[f.key] ? (
                    <EyeOff size={17} />
                  ) : (
                    <Eye size={17} />
                  )}
                </button>
              </div>
            ) : (
              <input
                name={f.key}
                type={f.type ?? "text"}
                dir={f.key === "phone" ? "ltr" : undefined}
                style={f.key === "phone" ? { textAlign: "right" } : undefined}
                min={f.min ?? (f.type === "number" ? "0" : undefined)}
                max={f.max}
                minLength={f.minLength}
                maxLength={f.maxLength}
                pattern={f.pattern}
                title={f.hint}
                step={f.step ?? (f.type === "number" ? "0.01" : undefined)}
                required={f.required !== false}
                defaultValue={initial[f.key] ?? f.default}
                autoComplete={
                  f.type === "password" ? "new-password" : undefined
                }
              />
            )}
          </Field>
        ))}
      </div>
      {(formError || error) && (
        <p className="form-error" role="alert">
          <CircleAlert size={16} />
          {formError || error}
        </p>
      )}
      <Button className="form-submit" disabled={busy}>
        {busy ? ar.loading : ar.save}
      </Button>
    </form>
  );
}

export const simple = (
  key: string,
  label: string,
  type = "text",
  required = true,
): FieldSpec => ({ key, label, type, required });

import "./partner-settings.css";
import { ChevronDown } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { readableError } from "../../app/notifications";

type Partner = { name: string; percent: string };
export function PartnerSettings() {
  const client = useQueryClient();
  const settings = useQuery({
    queryKey: ["accounting-partners"],
    queryFn: () => api("/accounting/partners"),
  });
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Partner[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const rows: Partner[] = draft ?? settings.data?.data ?? [];
  const validPercents = rows.every((p) =>
    /^\d{1,3}(\.\d{1,2})?$/.test(p.percent),
  );
  const total = rows.reduce(
    (sum, p) => sum + Math.round(Number(p.percent || 0) * 100),
    0,
  );
  const validation = !rows.length
    ? "أضف شريكًا واحدًا على الأقل، ثم أدخل الأسماء والنسب."
    : rows.some((p) => !p.name.trim() || p.name.trim().length > 100)
      ? "أدخل اسمًا لكل شريك، بحد أقصى 100 حرف."
      : new Set(rows.map((p) => p.name.trim())).size !== rows.length
        ? "أسماء الشركاء مكررة. استخدم اسمًا مختلفًا لكل شريك."
        : !validPercents || rows.some((p) => Number(p.percent) > 100)
          ? "أدخل نسبة من 0 إلى 100، بحد أقصى رقمين بعد العلامة العشرية."
          : total !== 10000
            ? "مجموع نسب الشركاء لازم يساوي 100%."
            : "";
  function edit(next: Partner[]) {
    setDraft(next);
    setError("");
    setSaved(false);
  }
  async function save() {
    if (validation || busy) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const result = await post(
        "/accounting/partners",
        rows.map((p) => ({ ...p, name: p.name.trim() })),
      );
      client.setQueryData(["accounting-partners"], result);
      setDraft(null);
      setSaved(true);
      await client.invalidateQueries({ queryKey: ["accounting"] });
    } catch (e) {
      setError(readableError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="partner-settings"
      aria-labelledby="partner-settings-title"
    >
      <header className="partner-settings-header">
        <button
          type="button"
          className="partner-settings-toggle"
          aria-label={`${expanded ? "إخفاء" : "عرض"} إعداد أسماء الشركاء ونسبهم`}
          aria-expanded={expanded}
          aria-controls="partner-settings-body"
          onClick={() => setExpanded(!expanded)}
        >
          <span>
            <span
              className="partner-settings-title"
              id="partner-settings-title"
            >
              إعداد أسماء الشركاء ونسبهم
            </span>
            <span className="partner-settings-hint">
              إدارة بيانات الشركاء ونسب توزيع الأرباح
            </span>
          </span>
          <span className="partner-settings-toggle-label" aria-hidden="true">
            <ChevronDown size={20} strokeWidth={1.8} />
          </span>
        </button>

        {expanded && (
          <>
            <p>
              أدخل أسماء الشركاء ونسبة كل شريك من الربح، ثم اضغط حفظ. يجب أن
              يكون المجموع 100%.
            </p>
            <p>
              التعديل يخص الفترات المفتوحة فقط. الإقفالات السابقة تحتفظ بالأسماء
              والنسب المحفوظة وقت الإقفال.
            </p>
          </>
        )}
      </header>
      <div
        id="partner-settings-body"
        className="partner-settings-content"
        hidden={!expanded}
      >
        {settings.isPending ? (
          <p role="status">جارٍ تحميل بيانات الشركاء...</p>
        ) : settings.isError ? (
          <div role="alert">
            <p>{readableError(settings.error)}</p>
            <Button onClick={() => void settings.refetch()}>
              إعادة تحميل الشركاء
            </Button>
          </div>
        ) : (
          <>
            {!rows.length && (
              <p>لم تُسجل بيانات الشركاء بعد. ابدأ بإضافة شريك.</p>
            )}
            <fieldset
              disabled={busy}
              style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
            >
              {rows.map((p, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 12,
                    alignItems: "end",
                    padding: "12px 0",
                    borderBottom: "1px solid var(--border, #ddd)",
                  }}
                >
                  <label style={{ flex: "1 1 180px", minWidth: 0 }}>
                    اسم الشريك {i + 1}
                    <input
                      aria-label={`اسم الشريك ${i + 1}`}
                      placeholder="أدخل اسم الشريك"
                      maxLength={100}
                      value={p.name}
                      style={{ width: "100%" }}
                      onChange={(e) =>
                        edit(
                          rows.map((x, j) =>
                            j === i ? { ...x, name: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <label style={{ flex: "0 1 160px", minWidth: 0 }}>
                    النسبة (%)
                    <input
                      aria-label={`نسبة الشريك ${i + 1}`}
                      type="number"
                      min="0"
                      max="100"
                      step="0.01"
                      dir="ltr"
                      value={p.percent}
                      style={{ width: "100%" }}
                      onChange={(e) =>
                        edit(
                          rows.map((x, j) =>
                            j === i ? { ...x, percent: e.target.value } : x,
                          ),
                        )
                      }
                    />
                  </label>
                  <Button
                    variant="ghost"
                    aria-label={`حذف الشريك ${i + 1}`}
                    onClick={() => edit(rows.filter((_, j) => i !== j))}
                  >
                    حذف
                  </Button>
                </div>
              ))}
            </fieldset>
            <div className="partner-settings-total">
              <strong>
                مجموع النسب:{" "}
                <bdi>
                  {Number.isFinite(total) ? (total / 100).toFixed(2) : "0.00"}%
                </bdi>
              </strong>
            </div>
            {draft !== null && (
              <p className="partner-settings-status" role="status">
                {validation ||
                  "توجد تعديلات لم تُحفظ بعد. احفظها لتظهر في توزيع الأرباح."}
              </p>
            )}
            {error && <p role="alert">{error}</p>}
            {saved && (
              <p
                role="status"
                className="partner-settings-status partner-settings-success"
              >
                تم حفظ أسماء الشركاء ونسبهم بنجاح. تم تحديث توزيع الفترات
                المفتوحة، والإقفالات السابقة لم تتغير.
              </p>
            )}
            <div className="partner-settings-actions">
              <Button
                variant="outline"
                disabled={busy || rows.length >= 30}
                onClick={() => edit([...rows, { name: "", percent: "" }])}
              >
                إضافة شريك
              </Button>
              <Button
                disabled={busy || !!validation || draft === null}
                onClick={() => void save()}
              >
                {busy ? "جارٍ الحفظ..." : "حفظ أسماء الشركاء ونسبهم"}
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

import { useState } from "react";
import { allowed, useTask, patch, FormField } from "../management/Tools";
import { ErrorMessage } from "../shared/Controls";
export function CustomerDiscount({
  customerId,
  percent,
}: {
  customerId: string;
  percent: string;
}) {
  const [value, setValue] = useState(percent),
    task = useTask();
  return (
    <section className="panel management-card">
      <h3>خصم العميل الدائم</h3>
      <p className="management-note">
        المعتمد حاليًا {percent}٪. يطبق بعد العرض وخصم الصنف، وقبل خصم الفاتورة
        والولاء. تغيير القاعدة يخص المبيعات الجديدة.
      </p>
      {allowed("settings.manage") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void task.run(() =>
              patch(`/customers/${customerId}/discount`, { percent: value }),
            );
          }}
        >
          <FormField label="نسبة خصم العميل (%)">
            <input
              type="number"
              min={0}
              max={100}
              step="0.01"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              required
            />
          </FormField>
          <button className="btn btn-outline" disabled={task.busy}>
            حفظ خصم العميل
          </button>
          <ErrorMessage message={task.error} />
        </form>
      )}
    </section>
  );
}

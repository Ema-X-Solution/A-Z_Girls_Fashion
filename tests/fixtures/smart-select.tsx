import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SmartSelect } from "../../apps/web/src/components/application/SmartSelect";
import {
  Field,
  Modal,
} from "../../apps/web/src/components/application/Primitives";
import "../../apps/web/src/style.css";
function Preview() {
  const [modal, setModal] = useState(false);
  const [value, setValue] = useState("");
  const [required, setRequired] = useState(true);
  const [disabled, setDisabled] = useState(false);
  const [submitted, setSubmitted] = useState("");
  return (
    <main
      dir="rtl"
      style={{ maxWidth: 1000, margin: "40px auto", padding: "0 20px" }}
    >
      <p style={{ color: "#94732b", fontSize: 12 }}>
        A&Z GIRLS FASHION · معاينة محلية
      </p>
      <h1 style={{ fontSize: 27, margin: "10px 0" }}>
        اختيار أسرع. مساحة أهدى.
      </h1>
      <p style={{ color: "#747880", marginBottom: 28 }}>
        ابحث واختار من نفس الخانة، من غير خطوات زيادة.
      </p>
      <section
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: 24,
          alignItems: "start",
        }}
      >
        <form
          style={{
            background: "white",
            border: "1px solid #e6e7eb",
            borderRadius: 18,
            padding: 24,
          }}
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(
              String(new FormData(e.currentTarget).get("cashierId")),
            );
          }}
        >
          <h2 style={{ fontSize: 18, marginBottom: 6 }}>طريقة الدفع</h2>
          <p style={{ fontSize: 12, color: "#888", marginBottom: 24 }}>
            اختار الموظف المسؤول عن الفاتورة.
          </p>
          <Field label="اسم الكاشير">
            <SmartSelect
              name="cashierId"
              label="اسم الكاشير"
              endpoint="/sales/cashiers"
              value={value}
              onChange={(row) => setValue(row.id)}
              optionLabel={(row) => row.name}
              required={required}
              disabled={disabled}
              placeholder="ابحث باسم الكاشير"
            />
          </Field>
          <p style={{ fontSize: 11, color: "#888", marginBottom: 24 }}>
            الاسم المختار هيتسجل على الفاتورة.
          </p>
          <button
            type="submit"
            style={{
              background: "#1c1c1b",
              color: "#e2c16e",
              borderRadius: 10,
              padding: 12,
              width: "100%",
            }}
          >
            متابعة الدفع
          </button>
          <output data-testid="submitted">{submitted}</output>
        </form>
        <aside style={{ padding: 24, background: "#f3f1eb", borderRadius: 18 }}>
          <h2 style={{ fontSize: 16, marginBottom: 15 }}>
            حقل واحد، كل الاختيارات
          </h2>
          <p style={{ fontSize: 13, lineHeight: 2, color: "#777" }}>
            اسم الموظف ظاهر بعد الاختيار.
            <br />
            البحث والنتائج جوه القائمة.
            <br />
            استخدم الأسهم وEnter للاختيار.
          </p>
        </aside>
      </section>
      <Modal
        open={modal}
        title="اختبار داخل نافذة"
        onClose={() => setModal(false)}
      >
        <div style={{ height: 400, overflow: "auto" }}>
          <div style={{ height: 230 }} />
          <SmartSelect
            name="modalId"
            label="موظف النافذة"
            endpoint="/sales/cashiers"
            value={value}
            onChange={(row) => setValue(row.id)}
            optionLabel={(row) => row.name}
          />
          <div style={{ height: 300 }} />
        </div>
      </Modal>
      <div style={{ marginTop: 650 }} data-testid="test-controls">
        <button onClick={() => setModal(true)}>Open modal</button>
        <button onClick={() => setValue("off-page")}>External value</button>
        <button onClick={() => setValue("")}>Reset value</button>
        <button onClick={() => setRequired(!required)}>Toggle required</button>
        <button onClick={() => setDisabled(!disabled)}>Toggle disabled</button>
      </div>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider
    client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
  >
    <Preview />
  </QueryClientProvider>,
);

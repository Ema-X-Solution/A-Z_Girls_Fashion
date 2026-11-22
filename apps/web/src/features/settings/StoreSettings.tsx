import { LogoSettings } from "../shared/LogoSettings";
import { patch } from "../../api";
import { ar } from "../../i18n";
import { LoyaltySettings } from "../customers/Loyalty";
import { useAction } from "../../app/notifications";
import { useData } from "../../hooks/useData";
import { Loading, ErrorState, Header } from "../../components/application/Primitives";
import { EntryForm, simple } from "../../components/application/EntryForm";

export function StoreSettings() {
  const query = useData("/store"),
    action = useAction();
  return (
    <>
      <Header
        title={ar.settings}
        subtitle="هوية المتجر وسياسات البيع والطباعة"
      />
      <LogoSettings />
      <LoyaltySettings />
      <section className="panel settings-panel">
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <EntryForm
            key={query.dataUpdatedAt}
            initial={query.data?.data}
            fields={[
              simple("name", "اسم المتجر"),
              simple("address", "العنوان", "text", false),
              simple("phone", ar.phone, "text", false),
              simple("branchName", "اسم الفرع المطبوع", "text", false),
              simple("taxNumber", "الرقم الضريبي", "text", false),
              simple("commercialRegister", "رقم السجل التجاري", "text", false),
              {
                key: "invoicePrefix",
                label: "بادئة رقم الفاتورة",
                default: "INV",
              },
              {
                key: "currency",
                label: "العملة",
                options: [{ value: "EGP", label: "جنيه مصري" }],
              },
              {
                key: "timezone",
                label: "المنطقة الزمنية",
                options: [{ value: "Africa/Cairo", label: "القاهرة" }],
              },
              simple("taxRate", "نسبة الضريبة (%)", "number"),
              {
                key: "taxMode",
                label: "طريقة احتساب الضريبة",
                default: "INCLUSIVE",
                options: [
                  {
                    value: "INCLUSIVE",
                    label: "الضريبة مشمولة داخل سعر البيع",
                  },
                  { value: "EXCLUSIVE", label: "الضريبة تُضاف إلى سعر البيع" },
                ],
              },
              simple("returnDays", "فترة الاسترجاع بالأيام", "number"),
              {
                key: "receiptWidth",
                label: "عرض الإيصال",
                options: [
                  { value: "80", label: "80 مم" },
                  { value: "58", label: "58 مم" },
                ],
              },
              simple("receiptFooter", "رسالة الإيصال", "textarea", false),
              simple(
                "returnPolicy",
                "سياسة الاستبدال والاسترجاع المطبوعة",
                "textarea",
                false,
              ),
            ]}
            busy={action.busy}
            submit={(body) =>
              void action.run(() =>
                patch("/settings/store", {
                  ...body,
                  returnDays: Number(body.returnDays),
                  receiptWidth: Number(body.receiptWidth),
                }),
              )
            }
          />
        )}
      </section>
    </>
  );
}

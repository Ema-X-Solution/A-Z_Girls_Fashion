import { Pagination } from "../../components/application/Pagination";
import { TableSkeleton } from "../../components/application/Skeleton";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../api";
import { formatDate, formatMoney } from "../../i18n";
import { Button } from "../../components/ui/button";
import { ErrorMessage } from "../shared/Controls";
import { CustomerLoyalty } from "./Loyalty";
import { CustomerDiscount } from "./CustomerDiscount";

export function CustomerHistory({ customerId }: { customerId: string }) {
  const [tab, setTab] = useState<"sales" | "returns">("sales");
  const paging = usePagination(`${customerId}|${tab}`,true,"local");
  const query = useQuery({
    queryKey: ["customer-history", customerId, paging.page, paging.pageSize],
    queryFn: ({ signal }) =>
      api(`/customers/${customerId}/history?${paging.query}`, { signal }),
  });
  const data = query.data?.data;
  if (query.isLoading) return <TableSkeleton />;
  if (query.error)
    return (
      <>
        <ErrorMessage message={query.error.message} />
        <Button variant="outline" onClick={() => void query.refetch()}>
          إعادة المحاولة
        </Button>
      </>
    );
  if (!data) return null;
  const rows = data[tab];
  const total = tab === "sales" ? data.total : data.returnCount;
  return (
    <div>
      <CustomerLoyalty customerId={customerId} />
      <CustomerDiscount
        key={customerId}
        customerId={customerId}
        percent={data.customer.discountPercent ?? "0"}
      />
      <p>
        <bdi dir="ltr" className="customer-phone">
          {data.customer.phone}
        </bdi>{" "}
        {data.customer.email ? ` • ${data.customer.email}` : ""}
      </p>
      {data.scope === "OWN" && (
        <p role="status">الأرقام والسجل يخصان مبيعاتك فقط حسب صلاحياتك.</p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>عدد الفواتير</th>
              <th>إجمالي المشتريات</th>
              <th>قيمة المرتجعات</th>
              <th>صافي الإنفاق</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{data.summary.purchaseCount}</td>
              <td>{formatMoney(data.summary.purchases)}</td>
              <td>{formatMoney(data.summary.returns)}</td>
              <td>
                <strong>{formatMoney(data.summary.netSpending)}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="head-actions" style={{ marginBlock: "16px" }}>
        <Button
          variant={tab === "sales" ? "default" : "outline"}
          onClick={() => {
            setTab("sales");
            paging.setPage(1);
          }}
        >
          المشتريات
        </Button>
        <Button
          variant={tab === "returns" ? "default" : "outline"}
          onClick={() => {
            setTab("returns");
            paging.setPage(1);
          }}
        >
          المرتجعات
        </Button>
      </div>
      {!rows.length ? (
        <p>لا توجد {tab === "sales" ? "مشتريات" : "مرتجعات"} مسجلة.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>الفاتورة</th>
                <th>الأصناف</th>
                <th>القيمة</th>
                {tab === "returns" && <th>سبب الإرجاع</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row: any) => (
                <tr key={row.id}>
                  <td>{formatDate(row.createdAt)}</td>
                  <td>
                    {row.receiptNumber ??
                      row.sale?.receiptNumber ??
                      `#${row.number ?? row.sale?.number}`}
                  </td>
                  <td>
                    {row.items.map((item: any) => (
                      <div key={item.id ?? item.saleItem.sku}>
                        {item.name ?? item.saleItem.name} × {item.quantity}
                        {item.returned ? ` (مرتجع: ${item.returned})` : ""}
                      </div>
                    ))}
                  </td>
                  <td>{formatMoney(row.total)}</td>
                  {tab === "returns" && <td>{row.reason}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={paging.page} pageSize={paging.pageSize} onPageChange={paging.setPage} onPageSizeChange={paging.setPageSize} total={total} length={rows.length} disabled={query.isFetching} />
    </div>
  );
}

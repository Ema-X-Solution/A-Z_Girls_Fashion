import { Pagination } from "../../components/application/Pagination";
import { usePagination } from "../../hooks/usePagination";
import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, ArrowUpLeft } from "lucide-react";
import { post } from "../../api";
import { ar, formatDate, formatMoney as fm } from "../../i18n";
import { Button } from "../../components/ui/button";
import { useAction, readableError } from "../../app/notifications";
import { ErrorMessage } from "../shared/Controls";
import { useData } from "../../hooks/useData";
import {
  Loading,
  ErrorState,
  Modal,
  Header,
  Badge,
  Table,
} from "../../components/application/Primitives";
import { EntryForm, simple } from "../../components/application/EntryForm";
import { type Row } from "../../app/types";

export function Shifts() {
  const paging = usePagination(),
    query = useData(`/shifts?${paging.query}`),
    current = useData("/shifts/current"),
    [open, setOpen] = useState(false),
    [openError, setOpenError] = useState(""),
    [closing, setClosing] = useState<Row | null>(null),
    action = useAction();
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
  }).format(new Date());
  const todayClosed = query.data?.todayClosed ?? query.data?.data?.find(
    (r: Row) =>
      r.closedAt &&
      new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo" }).format(
        new Date(r.openedAt),
      ) === today,
  );
  const reopen = (id: string) =>
    void action.run(() =>
      post(`/shifts/${id}/reopen`, {}, crypto.randomUUID()),
    );
  return (
    <>
      <Header
        title="ورديات درج المحل"
        subtitle="درج واحد لكل الكاشيرين، والعجز أو الزيادة على الدرج فقط"
      >
        {!current.data?.data && !todayClosed && (
          <Button
            onClick={() => {
              setOpenError("");
              setOpen(true);
            }}
          >
            <Plus size={18} />
            فتح وردية
          </Button>
        )}
      </Header>
      {!current.data?.data && todayClosed && (
        <div className="notice">
          <span>
            وردية اليوم مغلقة. عجز / زيادة الدرج: {fm(todayClosed.difference)}.
            الفرق على الدرج كله.
          </span>
          <Button disabled={action.busy} onClick={() => reopen(todayClosed.id)}>
            إعادة فتح وردية اليوم
          </Button>
        </div>
      )}
      {current.data?.data && (
        <div className="notice">
          <span className="status-dot" />
          وردية مفتوحة • {current.data.data.register.name} • رصيد الافتتاح{" "}
          {fm(current.data.data.openingCash)}
          <Link to="/pos">
            انتقل لنقطة البيع <ArrowUpLeft size={16} />
          </Link>
        </div>
      )}
      <section className="panel">
        {query.isLoading ? (
          <Loading />
        ) : query.error ? (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        ) : (
          <>
            <Table
              rows={query.data?.data ?? []}
              columns={[
                { label: ar.register, render: (r) => r.register.name },
                { label: "الافتتاح", render: (r) => formatDate(r.openedAt) },
                { label: "رصيد الافتتاح", render: (r) => fm(r.openingCash) },
                {
                  label: "النقد المتوقع",
                  render: (r) => (r.closedAt ? fm(r.expectedCash) : "—"),
                },
                {
                  label: "النقد الفعلي",
                  render: (r) => (r.closedAt ? fm(r.countedCash) : "—"),
                },
                {
                  label: "العجز / الزيادة",
                  render: (r) =>
                    r.closedAt ? (
                      <b
                        className={
                          Number(r.difference) < 0 ? "negative" : "positive"
                        }
                      >
                        {fm(r.difference)}
                      </b>
                    ) : (
                      "—"
                    ),
                },
                {
                  label: ar.actions,
                  render: (r) =>
                    !r.closedAt ? (
                      <Button variant="outline" onClick={() => setClosing(r)}>
                        إغلاق الوردية
                      </Button>
                    ) : (
                      <div>
                        <Badge value="مغلقة" />
                      </div>
                    ),
                },
              ]}
            />
            <Pagination
              page={paging.page}
              pageSize={paging.pageSize}
              onPageChange={paging.setPage}
              onPageSizeChange={paging.setPageSize}
              total={query.data?.total ?? 0}
              length={query.data?.data.length ?? 0}
              disabled={query.isFetching}
            />
          </>
        )}
      </section>
      <Modal title="فتح وردية" open={open} onClose={() => setOpen(false)}>
        <ErrorMessage message={openError} />
        <EntryForm
          fields={[
            {
              key: "registerId",
              label: ar.register,
              pickerEndpoint: "/options/registers",
            },
            simple("openingCash", "النقد الافتتاحي", "number"),
          ]}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              async () => {
                setOpenError("");
                try {
                  return await post("/shifts/open", body, crypto.randomUUID());
                } catch (error) {
                  setOpenError(readableError(error));
                  throw error;
                }
              },
              () => setOpen(false),
            )
          }
        />
      </Modal>
      <Modal
        title="إغلاق وتسوية الوردية"
        open={!!closing}
        onClose={() => setClosing(null)}
      >
        <p>
          أدخل النقد الفعلي بعد عدّ الدرج. الحساب يشمل رصيد الافتتاح وحركات الكاش
          لكل الكاشيرين فقط، بدون البطاقة أو المحفظة.
        </p>
        <EntryForm
          fields={[
            simple("countedCash", "النقد الفعلي", "number"),
            simple("notes", ar.notes, "textarea", false),
          ]}
          busy={action.busy}
          submit={(body) =>
            void action.run(
              () =>
                post(`/shifts/${closing?.id}/close`, body, crypto.randomUUID()),
              () => setClosing(null),
            )
          }
        />
      </Modal>
    </>
  );
}

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
  Pager,
} from "../../components/application/Primitives";
import { EntryForm, simple } from "../../components/application/EntryForm";
import { type Row } from "../../app/types";

export function Shifts() {
  const [offset, setOffset] = useState(0),
    query = useData(`/shifts?offset=${offset}`),
    current = useData("/shifts/current"),
    registers = useData("/registers"),
    [open, setOpen] = useState(false),
    [openError, setOpenError] = useState(""),
    [closing, setClosing] = useState<Row | null>(null),
    action = useAction();
  return (
    <>
      <Header
        title={ar.shifts}
        subtitle="رصيد افتتاحي واضح، وإغلاق قابل للمراجعة"
      >
        {!current.data?.data && (
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
                      <Badge value="مغلقة" />
                    ),
                },
              ]}
            />
            <Pager
              offset={offset}
              setOffset={setOffset}
              length={query.data?.data.length ?? 0}
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
              options:
                registers.data?.data.map((r: Row) => ({
                  value: r.id,
                  label: r.name,
                })) ?? [],
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
          أدخل النقد الفعلي بعد عدّ الدرج. يُحسب العجز أو الزيادة على الخادم ويُحفظ
          نهائياً.
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

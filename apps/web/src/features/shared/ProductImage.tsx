import { useEffect, useRef, useState } from "react";
import { ShoppingBag } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { ErrorMessage } from "./Controls";

export function ProductImage({
  url,
  name,
}: {
  url?: string | null;
  name: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  return url && failed !== url ? (
    <img
      className="product-photo"
      src={url}
      alt={name}
      loading="lazy"
      onError={() => setFailed(url)}
    />
  ) : (
    <ShoppingBag size={28} />
  );
}

export async function prepareProductImage(file: File): Promise<string> {
  let dataUrl = "";
  if (
    !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
    file.size > 10000000
  )
    throw new Error("اختار صورة PNG أو JPEG أو WebP أصغر من 10 ميجابايت.");
  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas"),
      ratio = Math.min(1, 800 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.85, 0.7, 0.5, 0.3]) {
      dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.length <= 186690) break;
    }
    if (dataUrl!.length > 186690)
      throw new Error("الصورة كبيرة بعد الضغط؛ اختار صورة أصغر.");
  } finally {
    bitmap.close();
  }
  return dataUrl;
}

export function ProductImagePicker({
  value,
  onChange,
  onBusyChange,
  disabled,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  onBusyChange: (busy: boolean) => void;
  disabled: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function select(file: File) {
    const attempt = ++sequence.current;
    setBusy(true);
    onBusyChange(true);
    setError("");
    try {
      const dataUrl = await prepareProductImage(file);
      if (attempt === sequence.current) onChange(dataUrl);
    } catch (e) {
      if (attempt === sequence.current)
        setError(e instanceof Error ? e.message : "تعذر قراءة الصورة");
    } finally {
      if (attempt === sequence.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }
  return (
    <section
      className="product-image-editor"
      aria-label="صورة المنتج الاختيارية"
    >
      <div className="product-image-preview">
        <ProductImage url={value} name="معاينة صورة المنتج" />
      </div>
      <div>
        <h3>
          صورة المنتج <small className="muted-text">(اختياري)</small>
        </h3>
        <p>
          تقدر تحفظ من غير صورة أو تضيفها لاحقًا. تظهر الصورة في المنتجات ونقطة
          البيع.
        </p>
        <div className="inline-actions">
          <label className="btn btn-outline">
            {busy
              ? "جارٍ تجهيز الصورة..."
              : value
                ? "تغيير الصورة"
                : "اختيار صورة"}
            <input
              type="file"
              aria-label="صورة المنتج (اختياري)"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={disabled || busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void select(file);
                e.target.value = "";
              }}
            />
          </label>
          {value && (
            <button
              type="button"
              className="btn btn-outline"
              disabled={disabled || busy}
              onClick={() => {
                onChange(null);
                setError("");
              }}
            >
              إزالة الصورة
            </button>
          )}
        </div>
        <ErrorMessage message={error} />
      </div>
    </section>
  );
}

export function ProductImageEditor({
  product,
  onChange,
}: {
  product: { id: string; nameAr: string; imageUrl?: string | null };
  onChange: (url: string | null) => void;
}) {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function save(file?: File) {
    setBusy(true);
    setError("");
    try {
      let dataUrl: string | null = null;
      if (file) {
        dataUrl = await prepareProductImage(file);
      }
      const result = await api(`/products/${product.id}/image`, {
        method: "POST",
        body: JSON.stringify({ dataUrl }),
      });
      onChange(result.data.imageUrl);
      await client.invalidateQueries({
        predicate: (q) =>
          q.queryKey.some(
            (k) =>
              typeof k === "string" &&
              (k.includes("products") || k.includes("barcodes")),
          ),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر حفظ الصورة");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="product-image-editor" aria-label="صورة المنتج">
      <div className="product-image-preview">
        <ProductImage url={product.imageUrl} name={product.nameAr} />
      </div>
      <div>
        <h3>صورة المنتج</h3>
        <p>تظهر في المنتجات ونقطة البيع. يتم ضغط الصورة تلقائيًا.</p>
        <div className="inline-actions">
          <label className="btn btn-outline">
            {busy
              ? "جارٍ الحفظ..."
              : product.imageUrl
                ? "استبدال الصورة"
                : "إضافة صورة"}
            <input
              type="file"
              aria-label="رفع صورة المنتج"
              accept="image/png,image/jpeg,image/webp"
              hidden
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void save(f);
                e.target.value = "";
              }}
            />
          </label>
          {product.imageUrl && (
            <button
              className="btn btn-outline"
              disabled={busy}
              onClick={() => {
                if (window.confirm("إزالة صورة المنتج؟")) void save();
              }}
            >
              إزالة الصورة
            </button>
          )}
        </div>
        <ErrorMessage message={error} />
      </div>
    </section>
  );
}

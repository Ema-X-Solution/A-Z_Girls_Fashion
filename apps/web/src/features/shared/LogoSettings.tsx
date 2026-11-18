import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import { BrandLogo } from "./BrandLogo";
import { ErrorMessage } from "./Controls";
export function LogoSettings() {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function upload(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      if (
        !["image/png", "image/jpeg", "image/webp"].includes(file.type) ||
        file.size > 10000000
      )
        throw new Error("اختار صورة PNG أو JPEG أو WebP أصغر من 10 ميجابايت.");
      const bitmap = await createImageBitmap(file),
        canvas = document.createElement("canvas"),
        ratio = Math.min(1, 512 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      await api("/settings/logo", {
        method: "POST",
        body: JSON.stringify({ dataUrl: canvas.toDataURL("image/jpeg", 0.88) }),
      });
      await client.invalidateQueries({ queryKey: ["branding"] });
      await client.invalidateQueries({ queryKey: ["/store"] });
    } catch (e) {
      setError(e instanceof Error ? e.message : "تعذر رفع اللوجو");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel logo-settings">
      <BrandLogo />
      <div>
        <h2>لوجو المتجر</h2>
        <p>
          يظهر في شاشة الدخول والقائمة والفواتير الجديدة. الفواتير السابقة تحتفظ
          بنسختها.
        </p>
        <label className="btn btn-outline">
          {busy ? "جارٍ حفظ اللوجو..." : "اختيار لوجو جديد"}
          <input
            aria-label="رفع لوجو المتجر"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            hidden
            disabled={busy}
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <ErrorMessage message={error} />
      </div>
    </section>
  );
}

import type { FormEvent } from "react";

// Arabic native-validation messages for plain <form> elements.
// EntryForm has its own built-in handler; spread these props on raw forms so
// the browser never shows its built-in English "please fill out this field".
function labelFor(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
) {
  if (el.id) {
    const label = el.ownerDocument.querySelector(`label[for="${el.id}"]`);
    if (label?.textContent?.trim()) return label.textContent.trim();
  }
  return (
    el.getAttribute("aria-label") ??
    el.closest("label")?.textContent?.trim() ??
    "هذا الحقل"
  );
}

export function validationMessage(
  el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  label = labelFor(el),
) {
  const v = el.validity;
  if (v.valueMissing) return `أكمل حقل ${label}.`;
  if (v.rangeUnderflow) {
    const min = el.getAttribute("min") ?? "0";
    return Number(min) > 0
      ? `${label} يجب أن يكون ${min} على الأقل.`
      : `${label} لا يمكن أن يكون سالبًا.`;
  }
  if (v.rangeOverflow)
    return `${label} يجب ألا يزيد عن ${el.getAttribute("max")}.`;
  if (v.stepMismatch)
    return el.getAttribute("step") === "1"
      ? `${label} يجب أن يكون عددًا صحيحًا.`
      : `راجع الدقة العشرية في ${label}.`;
  if (v.patternMismatch)
    return el.getAttribute("title")
      ? `${label}: ${el.getAttribute("title")}`
      : `راجع صيغة ${label}.`;
  if (v.tooShort) return `${label} أقصر من الحد الأدنى المطلوب.`;
  return `راجع قيمة ${label}.`;
}

export function arabicFormValidation() {
  return {
    onInvalid: (e: FormEvent<HTMLFormElement>) => {
      const el = e.target as HTMLInputElement;
      if ("validity" in el) el.setCustomValidity(validationMessage(el));
    },
    onInput: (e: FormEvent<HTMLFormElement>) => {
      const el = e.target as HTMLInputElement;
      if ("setCustomValidity" in el) el.setCustomValidity("");
    },
  };
}
